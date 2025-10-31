const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();

app.use(cors({
  origin: 'https://revolut-tau.vercel.app',
  credentials: true
}));

app.use(express.json());

// Configuration Revolut
const REVOLUT_CONFIG = {
  clientId: process.env.REVOLUT_CLIENT_ID,
  privateKey: process.env.REVOLUT_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Important pour le format
  redirectUri: process.env.REVOLUT_REDIRECT_URI || 'https://rev-backend-rho.vercel.app/auth/callback'
};

// Vérification au démarrage
console.log('🔧 Configuration Revolut:', {
  clientId: REVOLUT_CONFIG.clientId ? '✅ Défini' : '❌ Manquant',
  privateKey: REVOLUT_CONFIG.privateKey ? '✅ Défini' : '❌ Manquant',
  redirectUri: REVOLUT_CONFIG.redirectUri
});

// Middleware de vérification config
const checkConfig = (req, res, next) => {
  if (!REVOLUT_CONFIG.clientId || !REVOLUT_CONFIG.privateKey) {
    return res.status(500).json({
      error: 'Configuration Revolut incomplète',
      details: 'Vérifiez REVOLUT_CLIENT_ID et REVOLUT_PRIVATE_KEY'
    });
  }
  next();
};

// Route santé
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    oauth_configured: !!(REVOLUT_CONFIG.clientId && REVOLUT_CONFIG.privateKey),
    timestamp: new Date().toISOString()
  });
});

// Génération du JWT client assertion
function generateClientAssertion() {
  const payload = {
    iss: 'https://rev-backend-rho.vercel.app', // Doit matcher le domaine de redirect_uri
    sub: REVOLUT_CONFIG.clientId,
    aud: 'https://revolut.com',
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    iat: Math.floor(Date.now() / 1000)
  };

  console.log('📝 Génération JWT avec iss:', payload.iss);

  return jwt.sign(payload, REVOLUT_CONFIG.privateKey, { 
    algorithm: 'RS256'
  });
}

// 1. Initier le flux OAuth
app.get('/auth/revolut', checkConfig, (req, res) => {
  const authParams = new URLSearchParams({
    client_id: REVOLUT_CONFIG.clientId,
    redirect_uri: REVOLUT_CONFIG.redirectUri,
    response_type: 'code'
  });

  const authUrl = `https://sandbox-business.revolut.com/app-confirm?${authParams.toString()}`;
  
  console.log('🔗 Redirection OAuth vers Revolut');
  res.redirect(authUrl);
});

// 2. Callback OAuth - Échange code contre token
app.get('/auth/callback', checkConfig, async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    
    console.log('🔄 Callback OAuth reçu, code présent:', !!code);

    if (error) {
      console.error('❌ Erreur OAuth:', error_description || error);
      return res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(error_description || error)}`);
    }
    
    if (!code) {
      return res.redirect('https://revolut-tau.vercel.app/auth/error?message=Code d\'autorisation manquant');
    }

    // Générer le JWT
    const clientAssertion = generateClientAssertion();
    
    console.log('🔄 Échange du code contre token...');
    
    // Échanger code contre token d'accès
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
        redirect_uri: REVOLUT_CONFIG.redirectUri
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;
    
    console.log('✅ Token obtenu - Expire dans:', expires_in, 'secondes');
    
    // Redirection vers le frontend
    const redirectUrl = new URL('https://revolut-tau.vercel.app/auth/success');
    redirectUrl.searchParams.set('access_token', access_token);
    if (refresh_token) redirectUrl.searchParams.set('refresh_token', refresh_token);
    redirectUrl.searchParams.set('expires_in', expires_in);
    redirectUrl.searchParams.set('token_type', token_type);
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Erreur callback OAuth:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    
    const errorMessage = error.response?.data?.error_description || 
                        error.response?.data?.error || 
                        'Erreur d\'authentification';
    
    res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

// 3. Rafraîchir le token
app.post('/auth/refresh', checkConfig, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token requis' });
    }

    const clientAssertion = generateClientAssertion();
    
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('✅ Token rafraîchi');
    res.json(tokenResponse.data);
    
  } catch (error) {
    console.error('❌ Erreur refresh:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Erreur rafraîchissement token',
      details: error.response?.data || error.message 
    });
  }
});

// 4. Récupérer les comptes
app.get('/api/accounts', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token d\'accès requis' });
    }

    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/accounts', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Comptes récupérés:', response.data.length);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur comptes:', error.response?.status, error.response?.data?.error);
    
    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Token invalide ou expiré' });
    } else {
      res.status(500).json({ 
        error: 'Erreur récupération comptes',
        details: error.response?.data || error.message 
      });
    }
  }
});

// 5. Configuration OAuth pour le frontend
app.get('/api/oauth-config', (req, res) => {
  res.json({
    clientId: REVOLUT_CONFIG.clientId,
    authUrl: `https://sandbox-business.revolut.com/app-confirm`,
    redirectUri: REVOLUT_CONFIG.redirectUri,
    isConfigured: !!(REVOLUT_CONFIG.clientId && REVOLUT_CONFIG.privateKey)
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend Revolut démarré sur le port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
});