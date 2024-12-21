const express = require('express');
const { auth } = require('../firebase');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const router = express.Router();


// GET Requests
router.get('/login', (req, res) => {
  res.render('login');
});

router.get('/signup', (req, res) => {
  res.render('signup');
});

// POST Requests

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    res.status(201).json({
      message: 'User created successfully',
      user: userCredential.user,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    res.status(200).json(userCredential.user);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

module.exports = router;
