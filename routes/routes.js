const express = require('express');
const { db, auth } = require('../firebase');
const router = express.Router();

// GET Requests
router.get('/login', async (req, res) => {
  res.render('login');
});

router.get('/signup', async (req, res) => {
  res.render('signup');
})

// Post requests

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  try {
    
  } catch (error) {
    res.status(401).send(error.message);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    res.status(200).json(userCredential.user);
  } catch (error) {
    res.status(401).send(error.message);
  }
});

module.exports = router;