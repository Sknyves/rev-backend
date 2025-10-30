const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware CORS
app.use(cors({
  origin: 'https://revolut-tau.vercel.app',
  credentials: true
}));

app.use(express.json());

// Configuration avec validation améliorée
const REVOLUT_CONFIG = {
  clientId: process.env.REVOLUT_CLIENT_ID,
  clientSecret: process.env.REVOLUT_CLIENT_SECRET,
  redirectUri: process.env.REVOLUT_REDIRECT_URI || 'https://rev-backend-rho.vercel.app/auth/callback',
  sandbox: true
};

// Validation au démarrage
console.log('🔧 Configuration OAuth:', {
  clientId: REVOLUT_CONFIG.clientId ? '✅ Défini' : '❌ Manquant',
  clientSecret: REVOLUT_CONFIG.clientSecret ? '✅ Défini' : '❌ Manquant',
  redirectUri: REVOLUT_CONFIG.redirectUri
});

// Middleware pour vérifier la configuration OAuth
const checkOAuthConfig = (req, res, next) => {
  if (!REVOLUT_CONFIG.clientId || !REVOLUT_CONFIG.clientSecret) {
    return res.status(500).json({
      error: 'Configuration OAuth incomplète',
      details: 'Les variables REVOLUT_CLIENT_ID et REVOLUT_CLIENT_SECRET doivent être définies'
    });
  }
  next();
};

// Route santé
app.get('/health', (req, res) => {
  const oauthConfigured = !!(REVOLUT_CONFIG.clientId && REVOLUT_CONFIG.clientSecret);
  res.json({ 
    status: 'OK', 
    oauth_configured: oauthConfigured,
    message: 'Backend proxy Revolut opérationnel' 
  });
});

// Route pour initier le flux OAuth - CORRIGÉE
app.get('/auth/revolut', checkOAuthConfig, (req, res) => {
  const authParams = new URLSearchParams({
    client_id: REVOLUT_CONFIG.clientId,
    redirect_uri: REVOLUT_CONFIG.redirectUri,
    response_type: 'code',
    scope: 'read:account read:transaction read:counterparty' // Ajoutez les scopes nécessaires
  });

  const authUrl = `https://sandbox-business.revolut.com/app-confirm?${authParams.toString()}`;
  
  console.log('🔗 Redirection OAuth vers:', authUrl);
  res.redirect(authUrl);
});

// Callback OAuth - CORRIGÉ
app.get('/auth/callback', checkOAuthConfig, async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    
    if (error) {
      console.error('❌ Erreur OAuth callback:', error, error_description);
      return res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(error_description || error)}`);
    }
    
    if (!code) {
      return res.redirect('https://revolut-tau.vercel.app/auth/error?message=Code authorization manquant');
    }

    console.log('🔄 Échange du code contre token...');
    
    // Échanger le code contre un token d'accès
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: REVOLUT_CONFIG.clientId,
        client_secret: REVOLUT_CONFIG.clientSecret,
        code: code,
        redirect_uri: REVOLUT_CONFIG.redirectUri
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;
    
    console.log('✅ Token OAuth obtenu avec succès');
    
    // Rediriger vers le frontend avec le token
    const redirectUrl = new URL('https://revolut-tau.vercel.app/auth/success');
    redirectUrl.searchParams.set('access_token', access_token);
    redirectUrl.searchParams.set('refresh_token', refresh_token);
    redirectUrl.searchParams.set('expires_in', expires_in);
    redirectUrl.searchParams.set('token_type', token_type);
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ OAuth Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    
    const errorMessage = error.response?.data?.error_description || 
                        error.response?.data?.error || 
                        error.message;
    
    res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

// Route proxy pour les comptes
app.get('/api/accounts', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    console.log('🔐 Tentative de connexion à Revolut Sandbox...');
    
    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/accounts', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Comptes récupérés avec succès');
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur récupération comptes:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Clé API invalide' });
    } else {
      res.status(500).json({ 
        error: 'Erreur lors de la récupération des comptes',
        details: error.response?.data || error.message 
      });
    }
  }
});

// Route pour fournir la configuration OAuth au frontend
app.get('/api/oauth-config', (req, res) => {
  const config = {
    clientId: REVOLUT_CONFIG.clientId,
    authUrl: `https://sandbox-business.revolut.com/app-confirm`,
    redirectUri: REVOLUT_CONFIG.redirectUri,
    isConfigured: !!(REVOLUT_CONFIG.clientId && REVOLUT_CONFIG.clientSecret)
  };
  
  res.json(config);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend proxy Revolut démarré sur le port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});