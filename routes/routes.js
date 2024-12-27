const express = require('express');
const { auth, db } = require('../firebase');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, getDocs, deleteDoc } = require('firebase/firestore');
const router = express.Router();

// Middleware to check if user is authenticated
function checkAuth(req, res, next) {
  const user = auth.currentUser;
  if (user) {
    return res.redirect('/overview');
  }
  next();
}

// Function to check if a domain upon onboarding is available
async function checkDomainAvailability(domainValue) {
  try {
    const docRef = doc(db, "domains", domainValue);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return { available: false };
    } else {
      return { available: true };
    }
  } catch (error) {
    console.error("Error checking domain:", error);
    throw error;
  }
}

// GET Requests
router.get('/check-domain', async (req, res) => {
  const { domain } = req.query;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required' });
  }

  try {
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

router.get('/', (req, res) => {
  res.redirect('/dashboard');
});

router.get('/dashboard/:section?', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.redirect('/login');
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const subdomain = userDoc.data().subdomain;
    const domainDoc = await getDoc(doc(db, 'domains', subdomain));
    const userSubdomain = userDoc.data().subdomain;

    const section = req.params.section || 'overview';
    const validSections = ['overview', 'calendar', 'analytics', 'services'];
    
    if (!validSections.includes(section)) {
      return res.redirect('/dashboard/overview');
    }

    res.render('dashboard', { 
      user,
      active: section,
      domainData: domainDoc.data(),
      userSubdomain: userSubdomain
    });
  } catch (error) {
    console.error('Error fetching domain data:', error);
    res.status(500).render('error');
  }
});

router.get('/get-share-url', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const subdomain = userDoc.data().subdomain;
    
    res.json({ 
      subdomain,
      fullUrl: `${req.protocol}://${req.get('host')}/${subdomain}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get share URL' });
  }
});

// Route for accessing urls eg. syncset.xyz/website
router.get('/:subdomain', async (req, res) => {
  const { subdomain } = req.params;
  const isPreview = req.query.preview === 'true';
  const currentUser = auth.currentUser;
  
  try {
    const domainDoc = doc(db, 'domains', subdomain);
    const domainSnap = await getDoc(domainDoc);
    
    if (domainSnap.exists()) {
      const domainData = domainSnap.data();
      
      if (!domainData.published && 
          (!isPreview || !currentUser || domainData.uid !== currentUser.uid)) {
        return res.render('unpublished');
      }

      // Fetch services
      const servicesRef = collection(db, 'users', domainData.uid, 'services');
      const servicesSnap = await getDocs(servicesRef);
      const services = [];
      servicesSnap.forEach(doc => {
        services.push({ id: doc.id, ...doc.data() });
      });

      res.render('subdomain', {
        subdomain,
        title: domainData.title || `Welcome to ${subdomain}`,
        description: domainData.description || 'No description available',
        domainData: domainData,
        services: services
      });
    } else {
      res.status(404).render('404');
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error');
  }
});

// Get services for current user
router.get('/api/services', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const servicesRef = collection(db, 'users', user.uid, 'services');
        const servicesSnap = await getDocs(servicesRef);
        const services = [];
        
        servicesSnap.forEach(doc => {
            services.push({ id: doc.id, ...doc.data() });
        });

        res.json(services);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST Requests
router.post('/signup', async (req, res) => {
  const { email, password, domain: subdomain } = req.body;
  
  try {
    const domainDoc = doc(db, 'domains', subdomain);
    const domainSnap = await getDoc(domainDoc);

    if (domainSnap.exists()) {
      return res.status(400).json({ error: 'Subdomain already taken.' });
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      createdAt: new Date(),
      subdomain,
    });

    await setDoc(domainDoc, {
      uid: user.uid,
      published: false
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

router.post('/toggle-publish', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get user's domain
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const subdomain = userDoc.data().subdomain;
    
    // Get domain document
    const domainDoc = doc(db, 'domains', subdomain);
    const domainSnap = await getDoc(domainDoc);
    
    // Toggle published status
    const newPublishedStatus = !domainSnap.data().published;
    await setDoc(domainDoc, { 
      ...domainSnap.data(),
      published: newPublishedStatus 
    });

    res.json({ published: newPublishedStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new route to handle saving changes
router.post('/save-changes', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { title, description, theme } = req.body;
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const subdomain = userDoc.data().subdomain;
    
    await updateDoc(doc(db, 'domains', subdomain), {
      title,
      description,
      theme
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new service
router.post('/api/services', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const servicesRef = collection(db, 'users', user.uid, 'services');
        const docRef = await addDoc(servicesRef, {
            ...req.body,
            createdAt: new Date()
        });

        res.status(201).json({ id: docRef.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/services/:id', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { id } = req.params;
        const serviceRef = doc(db, 'users', user.uid, 'services', id);
        await deleteDoc(serviceRef);
        res.status(200).json({ message: 'Service deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('*', (req, res) => {
  res.status(404).render('404');
});

module.exports = router;