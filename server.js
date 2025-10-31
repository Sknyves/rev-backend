const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();

app.use(cors({
  origin: 'https://revolut-tau.vercel.app',
  credentials: true
}));

app.use(express.json());

// Configuration Revolut
const REVOLUT_CONFIG = {
  clientId: process.env.REVOLUT_CLIENT_ID,
  privateKey: process.env.REVOLUT_PRIVATE_KEY,
  redirectUri: process.env.REVOLUT_REDIRECT_URI || 'https://rev-backend-rho.vercel.app/auth/callback'
};

// Fonction robuste pour obtenir la clé privée
function getPrivateKey() {
  if (!REVOLUT_CONFIG.privateKey) {
    throw new Error('REVOLUT_PRIVATE_KEY non définie');
  }

  let privateKey = REVOLUT_CONFIG.privateKey.trim();
  
  console.log('🔧 Traitement de la clé privée:', {
    startsWith: privateKey.substring(0, 30),
    endsWith: privateKey.substring(privateKey.length - 30),
    length: privateKey.length
  });

  // Gestion des sauts de ligne échappés
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    console.log('✅ Sauts de ligne échappés convertis');
  }

  // Vérification du format
  const isPKCS8 = privateKey.includes('BEGIN PRIVATE KEY');
  const isRSA = privateKey.includes('BEGIN RSA PRIVATE KEY');
  const isEncrypted = privateKey.includes('ENCRYPTED PRIVATE KEY');

  if (!isPKCS8 && !isRSA) {
    console.error('❌ Format de clé non reconnu');
    console.log('Preview:', privateKey.substring(0, 100));
    throw new Error('Format de clé invalide. Doit être PKCS#8 ou RSA PRIVATE KEY');
  }

  console.log('✅ Format de clé détecté:', isPKCS8 ? 'PKCS#8' : 'RSA PRIVATE KEY');
  
  return privateKey;
}

// Test de la clé au démarrage
function testPrivateKey() {
  try {
    const privateKey = getPrivateKey();
    
    // Tester si la clé peut être utilisée pour signer
    const testPayload = { test: true };
    const testToken = jwt.sign(testPayload, privateKey, { algorithm: 'RS256' });
    
    console.log('✅ Test de signature réussi');
    return true;
  } catch (error) {
    console.error('❌ Test de signature échoué:', error.message);
    return false;
  }
}

// Route santé avec test de clé
app.get('/health', (req, res) => {
  try {
    const privateKey = getPrivateKey();
    const keyTest = testPrivateKey();
    
    res.json({ 
      status: 'OK', 
      oauth_configured: !!(REVOLUT_CONFIG.clientId && privateKey),
      key_test: keyTest ? 'PASSED' : 'FAILED',
      key_format: privateKey.includes('BEGIN PRIVATE KEY') ? 'PKCS#8' : 
                 privateKey.includes('BEGIN RSA PRIVATE KEY') ? 'RSA' : 'UNKNOWN',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      error: error.message,
      oauth_configured: false 
    });
  }
});

// Génération du JWT client assertion
function generateClientAssertion() {
  const privateKey = getPrivateKey();
  
  const payload = {
    iss: 'https://rev-backend-rho.vercel.app',
    sub: REVOLUT_CONFIG.clientId,
    aud: 'https://revolut.com',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000)
  };

  console.log('📝 Génération JWT avec clé de longueur:', privateKey.length);

  try {
    const token = jwt.sign(payload, privateKey, { 
      algorithm: 'RS256'
    });
    console.log('✅ JWT généré avec succès');
    return token;
  } catch (error) {
    console.error('❌ Erreur signature JWT:', error.message);
    
    // Essayons avec une approche alternative si RSA
    if (privateKey.includes('BEGIN RSA PRIVATE KEY')) {
      console.log('🔄 Tentative avec format RSA...');
      try {
        const token = jwt.sign(payload, privateKey, { 
          algorithm: 'RS256'
        });
        console.log('✅ JWT généré avec format RSA');
        return token;
      } catch (rsaError) {
        throw new Error(`Échec signature RSA: ${rsaError.message}`);
      }
    }
    
    throw error;
  }
}

// Middleware de vérification
const checkConfig = (req, res, next) => {
  try {
    getPrivateKey();
    if (!REVOLUT_CONFIG.clientId) {
      throw new Error('REVOLUT_CLIENT_ID manquant');
    }
    next();
  } catch (error) {
    res.status(500).json({
      error: 'Configuration Revolut invalide',
      details: error.message
    });
  }
};

// Route de diagnostic détaillée
app.get('/debug/key-full', (req, res) => {
  try {
    const privateKey = process.env.REVOLUT_PRIVATE_KEY;
    
    const keyInfo = {
      key_preview: privateKey.substring(0, 100) + '...',
      key_ends_with: '...' + privateKey.substring(privateKey.length - 100),
      total_length: privateKey.length,
      has_actual_newlines: privateKey.includes('\n'),
      has_escaped_newlines: privateKey.includes('\\n'),
      begins_with: privateKey.substring(0, 50),
      ends_with: privateKey.substring(privateKey.length - 50),
      key_type: privateKey.includes('BEGIN PRIVATE KEY') ? 'PKCS#8' : 
               privateKey.includes('BEGIN RSA PRIVATE KEY') ? 'RSA' : 
               privateKey.includes('ENCRYPTED') ? 'ENCRYPTED' : 'UNKNOWN'
    };

    // Test de la clé
    try {
      const testKey = getPrivateKey();
      const testToken = jwt.sign({ test: true }, testKey, { algorithm: 'RS256' });
      keyInfo.signature_test = 'SUCCESS';
    } catch (signError) {
      keyInfo.signature_test = 'FAILED: ' + signError.message;
    }

    res.json(keyInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Les autres routes restent similaires...
app.get('/auth/revolut', checkConfig, (req, res) => {
  const authParams = new URLSearchParams({
    client_id: REVOLUT_CONFIG.clientId,
    redirect_uri: REVOLUT_CONFIG.redirectUri,
    response_type: 'code'
  });

  const authUrl = `https://sandbox-business.revolut.com/app-confirm?${authParams.toString()}`;
  console.log('🔗 Redirection OAuth');
  res.redirect(authUrl);
});

app.get('/auth/callback', checkConfig, async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    
    console.log('🔄 Callback OAuth, code présent:', !!code);
    console.log('📋 Code reçu:', code?.substring(0, 20) + '...');

    if (error) {
      console.error('❌ Erreur OAuth:', error_description || error);
      return res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(error_description || error)}`);
    }
    
    if (!code) {
      return res.redirect('https://revolut-tau.vercel.app/auth/error?message=Code manquant');
    }

    // Générer le JWT avec plus de détails
    const clientAssertion = generateClientAssertion();
    console.log('🔐 JWT généré (premieres 50 chars):', clientAssertion.substring(0, 50) + '...');

    // Préparer la requête token avec logging
    const tokenData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
      redirect_uri: REVOLUT_CONFIG.redirectUri
    });

    console.log('📤 Requête token vers Revolut:');
    console.log('   URL: https://sandbox-b2b.revolut.com/api/1.0/auth/token');
    console.log('   grant_type: authorization_code');
    console.log('   code:', code.substring(0, 10) + '...');
    console.log('   redirect_uri:', REVOLUT_CONFIG.redirectUri);
    console.log('   client_assertion_type: jwt-bearer');
    console.log('   client_assertion_length:', clientAssertion.length);
    
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      tokenData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000,
        // Ajouter le logging des requêtes
        transformRequest: [(data) => {
          console.log('📨 Données envoyées:', data.toString().substring(0, 200) + '...');
          return data;
        }]
      }
    );

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;
    
    console.log('✅ Token obtenu avec succès');
    
    const redirectUrl = new URL('https://revolut-tau.vercel.app/auth/success');
    redirectUrl.searchParams.set('access_token', access_token);
    if (refresh_token) redirectUrl.searchParams.set('refresh_token', refresh_token);
    redirectUrl.searchParams.set('expires_in', expires_in);
    redirectUrl.searchParams.set('token_type', token_type);
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Erreur détaillée callback:');
    console.error('   Status:', error.response?.status);
    console.error('   Status Text:', error.response?.statusText);
    console.error('   Headers:', error.response?.headers);
    console.error('   Data:', error.response?.data);
    console.error('   Message:', error.message);
    
    let errorMessage = 'Erreur authentification';
    
    if (error.response?.data) {
      errorMessage = error.response.data.error_description || 
                    error.response.data.error || 
                    JSON.stringify(error.response.data);
    }
    
    res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend démarré sur le port ${PORT}`);
  console.log(`📍 Health: https://rev-backend-rho.vercel.app/health`);
  console.log(`🔧 Debug: https://rev-backend-rho.vercel.app/debug/key-full`);
});