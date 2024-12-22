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

// GET Requests
router.get('/check-domain', async (req, res) => {
  const { domain } = req.query;

  if (!domain) {
    return res.status(400).json({ available: false, error: 'Domain is required' });
  }

  try {
    const docRef = doc(db, 'domains', domain); // Assuming your domains are stored in a Firestore collection
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      res.json({ available: false }); // Domain exists
    } else {
      res.json({ available: true }); // Domain is available
    }
  } catch (error) {
    console.error('Error checking domain:', error);
    res.status(500).json({ available: false, error: 'Internal server error' });
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
  const { email, password, subdomain } = req.body;
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
    res.status(400).json({ error: error.message });
  }
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