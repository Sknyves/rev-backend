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

    if (error) {
      return res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(error_description || error)}`);
    }
    
    if (!code) {
      return res.redirect('https://revolut-tau.vercel.app/auth/error?message=Code manquant');
    }

    // Générer le JWT
    const clientAssertion = generateClientAssertion();
    
    console.log('🔄 Échange code contre token...');
    
    // DEBUG: Afficher tous les paramètres
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
      redirect_uri: REVOLUT_CONFIG.redirectUri
    });

    console.log('🔍 Paramètres de la requête:');
    console.log('   - grant_type: authorization_code');
    console.log('   - code:', code.substring(0, 10) + '...');
    console.log('   - client_assertion_type: jwt-bearer');
    console.log('   - redirect_uri:', REVOLUT_CONFIG.redirectUri);
    console.log('   - client_assertion_length:', clientAssertion.length);
    
    const tokenResponse = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/auth/token',
      tokenParams,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Revolut-API-Client/1.0'
        },
        timeout: 15000
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
    console.error('❌ Erreur détaillée:');
    console.error('   Status:', error.response?.status);
    console.error('   Data:', error.response?.data);
    console.error('   Headers:', error.response?.headers);
    
    // Log supplémentaire pour diagnostic
    if (error.response?.data) {
      console.error('   Error:', error.response.data.error);
      console.error('   Error Description:', error.response.data.error_description);
    }
    
    const errorMessage = error.response?.data?.error_description || 
                        error.response?.data?.error || 
                        'Erreur authentification Revolut';
    
    res.redirect(`https://revolut-tau.vercel.app/auth/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

// =============================================
// ROUTES PRINCIPALES REVOLUT BUSINESS API
// =============================================

// Middleware pour vérifier le token
const requireAuth = async (req, res, next) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token d\'accès requis' });
    }

    // Optionnel: Vérifier que le token est valide en faisant une requête test
    req.accessToken = accessToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token invalide' });
  }
};

// =============================================
// COMPTES ET SOLDES
// =============================================

// 1. Récupérer tous les comptes
app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/accounts', {
      headers: {
        'Authorization': `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ ${response.data.length} comptes récupérés`);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur comptes:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 2. Récupérer un compte spécifique
app.get('/api/accounts/:accountId', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const response = await axios.get(`https://sandbox-b2b.revolut.com/api/1.0/accounts/${accountId}`, {
      headers: {
        'Authorization': `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur compte spécifique:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 3. Récupérer le solde d'un compte
app.get('/api/accounts/:accountId/balance', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const response = await axios.get(`https://sandbox-b2b.revolut.com/api/1.0/accounts/${accountId}`, {
      headers: {
        'Authorization': `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      account_id: accountId,
      balance: response.data.balance,
      currency: response.data.currency,
      available_balance: response.data.available_balance || response.data.balance
    });
    
  } catch (error) {
    console.error('❌ Erreur solde:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// =============================================
// TRANSACTIONS
// =============================================

// 4. Récupérer les transactions d'un compte
app.get('/api/accounts/:accountId/transactions', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { from, to, limit, type } = req.query;
    
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (limit) params.append('limit', limit);
    if (type) params.append('type', type);
    
    const response = await axios.get(
      `https://sandbox-b2b.revolut.com/api/1.0/accounts/${accountId}/transactions?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`✅ ${response.data.length} transactions récupérées`);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur transactions:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 5. Récupérer une transaction spécifique
app.get('/api/transactions/:transactionId', requireAuth, async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const response = await axios.get(
      `https://sandbox-b2b.revolut.com/api/1.0/transaction/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur transaction:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// =============================================
// CONTACTS (COUNTERPARTIES)
// =============================================

// 6. Récupérer tous les contacts
app.get('/api/counterparties', requireAuth, async (req, res) => {
  try {
    const response = await axios.get('https://sandbox-b2b.revolut.com/api/1.0/counterparties', {
      headers: {
        'Authorization': `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ ${response.data.length} contacts récupérés`);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur contacts:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 7. Ajouter un nouveau contact
app.post('/api/counterparties', requireAuth, async (req, res) => {
  try {
    const { profile_type, name, email, phone, bank_country, currency, account_no, sort_code, iban, bic } = req.body;
    
    const counterpartyData = {
      profile_type: profile_type || 'business',
      name,
      email,
      phone,
      bank_country,
      currency,
      account_no,
      sort_code,
      iban,
      bic
    };
    
    const response = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/counterparties',
      counterpartyData,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Contact ajouté:', response.data.id);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur ajout contact:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 8. Supprimer un contact
app.delete('/api/counterparties/:counterpartyId', requireAuth, async (req, res) => {
  try {
    const { counterpartyId } = req.params;
    
    await axios.delete(
      `https://sandbox-b2b.revolut.com/api/1.0/counterparties/${counterpartyId}`,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Contact supprimé:', counterpartyId);
    res.json({ success: true, message: 'Contact supprimé' });
    
  } catch (error) {
    console.error('❌ Erreur suppression contact:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// =============================================
// TRANSFERTS
// =============================================

// 9. Effectuer un transfert
app.post('/api/transfers', requireAuth, async (req, res) => {
  try {
    const { request_id, source_account_id, target_account_id, amount, currency, reference } = req.body;
    
    const transferData = {
      request_id: request_id || `req_${Date.now()}`,
      source_account_id,
      target_account_id,
      amount: parseFloat(amount),
      currency,
      reference: reference || 'Transfert via API'
    };
    
    const response = await axios.post(
      'https://sandbox-b2b.revolut.com/api/1.0/transfer',
      transferData,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Transfert effectué:', response.data.id);
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur transfert:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 10. Récupérer l'état d'un transfert
app.get('/api/transfers/:transactionId', requireAuth, async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const response = await axios.get(
      `https://sandbox-b2b.revolut.com/api/1.0/transaction/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur état transfert:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// =============================================
// TAUX DE CHANGE
// =============================================

// 11. Récupérer les taux de change
app.get('/api/rates', requireAuth, async (req, res) => {
  try {
    const { pair } = req.query; // Format: EURGBP, USDGBP, etc.
    
    const url = pair 
      ? `https://sandbox-b2b.revolut.com/api/1.0/rate/${pair}`
      : 'https://sandbox-b2b.revolut.com/api/1.0/rate';
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ Erreur taux change:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// 12. Convertir une devise
app.post('/api/convert', requireAuth, async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    
    // D'abord récupérer le taux
    const rateResponse = await axios.get(
      `https://sandbox-b2b.revolut.com/api/1.0/rate/${from}${to}`,
      {
        headers: {
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const rate = rateResponse.data.rate;
    const convertedAmount = amount * rate;
    
    res.json({
      from_currency: from,
      to_currency: to,
      from_amount: amount,
      to_amount: convertedAmount,
      rate: rate,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur conversion:', error.response?.data || error.message);
    handleRevolutError(error, res);
  }
});

// =============================================
// UTILITAIRES
// =============================================

// Gestionnaire d'erreurs Revolut
function handleRevolutError(error, res) {
  if (error.response?.status === 401) {
    res.status(401).json({ error: 'Token d\'accès invalide ou expiré' });
  } else if (error.response?.status === 400) {
    res.status(400).json({ 
      error: 'Requête invalide',
      details: error.response.data 
    });
  } else if (error.response?.status === 404) {
    res.status(404).json({ error: 'Ressource non trouvée' });
  } else if (error.response?.status === 429) {
    res.status(429).json({ error: 'Limite de requêtes dépassée' });
  } else {
    res.status(500).json({ 
      error: 'Erreur serveur Revolut',
      details: error.response?.data || error.message 
    });
  }
}

// Route de statut API
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    // Tester plusieurs endpoints pour vérifier la connectivité
    const [accountsRes, counterpartiesRes] = await Promise.all([
      axios.get('https://sandbox-b2b.revolut.com/api/1.0/accounts', {
        headers: { 'Authorization': `Bearer ${req.accessToken}` }
      }).catch(() => ({ data: [] })),
      axios.get('https://sandbox-b2b.revolut.com/api/1.0/counterparties', {
        headers: { 'Authorization': `Bearer ${req.accessToken}` }
      }).catch(() => ({ data: [] }))
    ]);
    
    res.json({
      status: 'connected',
      accounts_count: accountsRes.data.length,
      counterparties_count: counterpartiesRes.data.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend démarré sur le port ${PORT}`);
  console.log(`📍 Health: https://rev-backend-rho.vercel.app/health`);
  console.log(`🔧 Debug: https://rev-backend-rho.vercel.app/debug/key-full`);
});