const express = require('express');
const { db, auth } = require('../firebase');
const router = express.Router();

// GET Requests
router.get('/login', async (req, res) => {
  res.render('login');
});

router.get('/signup', async (req, res) => {
  
})

router.get('/data', async (req, res) => {
  try {
    const querySnapshot = await db.collection('your-collection').get();
    const data = querySnapshot.docs.map(doc => doc.data());
    res.status(200).json(data);
  } catch (error) {
    res.status(500).send(error.message);
  }
});


// Post requests

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