const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware CORS pour autoriser les requêtes depuis Vue.js
app.use(cors({
  origin: 'https://revolut-tau.vercel.app', // URL de ton frontend Vue.js
  credentials: true
}));

app.use(express.json());

// Route santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend proxy Revolut opérationnel' });
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
    } else if (error.code === 'ECONNREFUSED') {
      res.status(503).json({ error: 'Service Revolut indisponible' });
    } else {
      res.status(500).json({ 
        error: 'Erreur lors de la récupération des comptes',
        details: error.response?.data || error.message 
      });
    }
  }
});

// Route proxy pour les transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/transactions', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      params: {
        limit: req.query.limit || 50
      },
      timeout: 10000
    });
    
    res.json(response.data);
    
  } catch (error) {
    console.error('Erreur récupération transactions:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des transactions',
      details: error.response?.data || error.message 
    });
  }
});

// Route proxy pour les bénéficiaires
app.get('/api/counterparties', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/counterparties', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    res.json(response.data);
    
  } catch (error) {
    console.error('Erreur récupération bénéficiaires:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des bénéficiaires',
      details: error.response?.data || error.message 
    });
  }
});

// Test de connexion
app.get('/api/test', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/accounts', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    res.json({ 
      success: true, 
      message: '✅ Connexion à Revolut Sandbox réussie!',
      status: response.status
    });
    
  } catch (error) {
    console.error('Test connexion échoué:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      res.status(401).json({ 
        success: false, 
        error: '❌ Clé API invalide ou expirée' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: '❌ Erreur de connexion à Revolut',
        details: error.response?.data || error.message 
      });
    }
  }
});

// server.js - Configuration OAuth corrigée
const REVOLUT_CONFIG = {
  clientId: process.env.REVOLUT_CLIENT_ID,
  clientSecret: process.env.REVOLUT_CLIENT_SECRET,
  redirectUri: process.env.REVOLUT_REDIRECT_URI || 'https://rev-backend-rho.vercel.app/auth/callback',
  sandbox: true
};

// Ajoutez cette validation au démarrage
console.log('🔧 Configuration OAuth:', {
  clientId: REVOLUT_CONFIG.clientId ? '✅ Défini' : '❌ Manquant',
  clientSecret: REVOLUT_CONFIG.clientSecret ? '✅ Défini' : '❌ Manquant',
  redirectUri: REVOLUT_CONFIG.redirectUri
});

// Route pour initier le flux OAuth - CORRIGÉE
app.get('/auth/revolut', (req, res) => {
  if (!REVOLUT_CONFIG.clientId || !REVOLUT_CONFIG.clientSecret) {
    return res.status(500).json({ 
      error: 'Configuration OAuth manquante',
      details: 'Vérifiez REVOLUT_CLIENT_ID et REVOLUT_CLIENT_SECRET' 
    });
  }

  const authUrl = `https://sandbox-business.revolut.com/app-confirm?` +
    `client_id=${REVOLUT_CONFIG.clientId}` +
    `&redirect_uri=${encodeURIComponent(REVOLUT_CONFIG.redirectUri)}` +
    `&response_type=code`;
  
  console.log('🔗 Redirection OAuth vers:', authUrl);
  res.redirect(authUrl);
});

// Callback OAuth - CORRIGÉ
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    
    if (error) {
      console.error('❌ Erreur OAuth callback:', error, error_description);
      return res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(error_description || error)}`);
    }
    
    if (!code) {
      return res.status(400).redirect('https://revolut-tau.vercel.app/auth/error?message=Code authorization manquant');
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

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    console.log('✅ Token OAuth obtenu avec succès');
    
    // Rediriger vers le frontend avec le token
    res.redirect(`https://revolut-tau.vercel.app/auth/success?access_token=${access_token}`);
    
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

// Route pour fournir la configuration OAuth au frontend
app.get('/api/oauth-config', (req, res) => {
  res.json({
    clientId: process.env.REVOLUT_CLIENT_ID,
    authUrl: `https://sandbox-business.revolut.com/app-confirm`,
    redirectUri: process.env.REVOLUT_REDIRECT_URI
  });
});

// Route pour rafraîchir le token
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: REVOLUT_CONFIG.clientId,
        client_secret: REVOLUT_CONFIG.clientSecret,
        refresh_token: refresh_token
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    res.json(tokenResponse.data);
  } catch (error) {
    console.error('Refresh Token Error:', error.response?.data || error.message);
    res.status(400).json({ 
      error: 'Erreur lors du rafraîchissement du token',
      details: error.response?.data 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend proxy Revolut démarré sur le port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Prêt à recevoir les requêtes du frontend Vue.js`);
});