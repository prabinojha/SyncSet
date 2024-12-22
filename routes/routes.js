const express = require('express');
const { auth, db } = require('../firebase');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { doc, setDoc, getDoc } = require('firebase/firestore');
const router = express.Router();

// Middleware to check if user is authenticated
function checkAuth(req, res, next) {
  const user = auth.currentUser;
  if (user) {
    return res.redirect('/overview');
  }
  next();
}

async function checkDomainAvailability(domainValue) {
  try {
    const docRef = doc(db, "domains", domainValue);
    const docSnap = await getDoc(docRef);

    // Check if the document exists
    if (docSnap.exists()) {
      return { available: false }; // Domain is taken
    } else {
      return { available: true }; // Domain is available
    }
  } catch (error) {
    console.error("Error checking domain:", error);
    throw error; // Re-throw error to handle it elsewhere
  }
}

// GET Requests
router.get('/check-domain', async (req, res) => {
  const { domain } = req.query;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required' });
  }

  try {
    // Use the existing checkDomainAvailability helper function
    const result = await checkDomainAvailability(domain);
    res.json(result);
  } catch (error) {
    console.error('Error checking domain:', error);
    res.status(500).json({ error: 'Failed to check domain' });
  }
});

router.get('/login', checkAuth, (req, res) => {
  res.render('login');
});

router.get('/signup', checkAuth, (req, res) => {
  res.render('signup');
});

router.get('/overview', (req, res) => {
  const user = auth.currentUser;
  if (user) {
    return res.render('overview', { user });
  }
  res.redirect('/login');
});

// POST Requests
router.post('/signup', async (req, res) => {
  const { email, password, domain: subdomain } = req.body;
  
  // Add validation
  if (!email || !password || !subdomain) {
    return res.status(400).json({ error: 'Email, password, and subdomain are required' });
  }

  // Validate that inputs are strings
  if (typeof email !== 'string' || typeof password !== 'string' || typeof subdomain !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }

  try {
    // Check if subdomain exists
    const domainDoc = doc(db, 'domains', subdomain);
    const domainSnap = await getDoc(domainDoc);

    if (domainSnap.exists()) {
      return res.status(400).json({ error: 'Subdomain already taken.' });
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Add user to Firestore collection
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      createdAt: new Date(),
      subdomain,
    });

    // Add subdomain to Firestore
    await setDoc(domainDoc, {
      uid: user.uid,
    });

    res.status(201).json({
      message: 'User created successfully',
      user: user,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    res.status(200).json({
      message: 'Login successful',
      user: userCredential.user,
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Logout Route
router.post('/logout', async (req, res) => {
  try {
    await signOut(auth);
    res.redirect('/login');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;