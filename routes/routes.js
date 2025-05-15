const express = require('express');
const { auth, db } = require('../firebase');
const { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updateEmail, 
  updatePassword,
  sendEmailVerification,
  applyActionCode,
  verifyBeforeUpdateEmail,
  sendPasswordResetEmail,
  confirmPasswordReset
} = require('firebase/auth');
const { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, getDocs, deleteDoc } = require('firebase/firestore');
const router = express.Router();

// Middleware to check if user is authenticated
function checkAuth(req, res, next) {
  const user = auth.currentUser;
  if (user) {
    return res.redirect('/dashboard/overview');
  }
  next();
}

// Middleware to check if user's email is verified
async function checkEmailVerified(req, res, next) {
  const user = auth.currentUser;
  if (!user) {
    return res.redirect('/login');
  }
  
  // If Firebase Auth says the email is verified, update Firestore if needed
  if (user.emailVerified) {
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      
      // Update Firestore if it's out of sync with Auth
      if (!userData.emailVerified) {
        await updateDoc(doc(db, 'users', user.uid), {
          emailVerified: true
        });
      }
      
      // User is verified, proceed to the route
      return next();
    } catch (error) {
      console.error('Error checking user verification status:', error);
    }
  }
  
  // Double-check with Firestore - in case Auth state is stale
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists() && userDoc.data().emailVerified) {
      // User is verified in Firestore but not in Auth, 
      // proceed to the route anyway (Auth will refresh)
      return next();
    }
  } catch (error) {
    console.error('Error checking Firestore verification status:', error);
  }
  
  // User is not verified, redirect to verification page
  return res.redirect('/verify-email');
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

router.get('/verify-email', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.redirect('/login');
  }
  
  // Check if user is already verified
  if (user.emailVerified) {
    // Firebase says verified - double check with Firestore
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        // If verified in Firestore too, redirect to dashboard
        if (userDoc.data().emailVerified) {
          return res.redirect('/dashboard/overview');
        }
        
        // Firebase says verified but Firestore doesn't - update Firestore
        await updateDoc(doc(db, 'users', user.uid), {
          emailVerified: true
        });
        return res.redirect('/dashboard/overview');
      }
    } catch (error) {
      console.error('Error checking verification status:', error);
    }
  }
  
  // If we reach here, user needs to verify email
  res.render('verify-email', { email: user.email });
});

router.get('/email-action', async (req, res) => {
  const { mode, oobCode, continueUrl } = req.query;

  if (mode === 'verifyEmail' && oobCode) {
    try {
      await applyActionCode(auth, oobCode);
      
      const user = auth.currentUser;
      
      // If user is already logged in, update their document
      if (user) {
        // Reload the user to get latest state
        await user.reload();
        
        // Update user's email verification status in Firestore
        await updateDoc(doc(db, 'users', user.uid), {
          emailVerified: true
        });
        
        // Redirect to dashboard after verification
        if (continueUrl) {
          // If a continueUrl was provided in the verification email, use it
          return res.redirect(continueUrl);
        } else {
          return res.redirect('/dashboard/overview');
        }
      }
      
      // If user is not logged in, show verification success page with auto-redirect
      res.render('email-verified', { 
        success: true,
        // Add a query param to trigger automatic login
        autoLogin: true
      });
    } catch (error) {
      console.error('Error verifying email:', error);
      res.render('email-verified', { 
        success: false, 
        error: error.message
      });
    }
  } else if (mode === 'resetPassword' && oobCode) {
    // Redirect to our password reset page
    res.redirect(`/password-reset?mode=${mode}&oobCode=${oobCode}`);
  } else {
    res.status(400).render('error', { message: 'Invalid request' });
  }
});

router.get('/', (req, res) => {
  const user = auth.currentUser;
  res.render('home', { user, isHomePage: true });
});

router.get('/dashboard/:section?', checkEmailVerified, async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
    return res.redirect('/');
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const subdomain = userDoc.data().subdomain;
    const domainDoc = await getDoc(doc(db, 'domains', subdomain));
    const userSubdomain = userDoc.data().subdomain;

    const section = req.params.section || 'overview';
    const validSections = ['overview', 'calendar', 'analytics', 'services', 'user'];
    
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
        return res.render('unpublished', { isSubdomain: true });
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
        services: services,
        isSubdomain: true
      });
    } else {
      res.status(404).render('404', { isSubdomain: true });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { isSubdomain: true });
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
  
  // Validate password strength
  const passwordStrengthRegex = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  };
  
  const passedChecks = Object.values(passwordStrengthRegex).filter(Boolean).length;
  if (passedChecks < 3) {
    return res.status(400).json({ error: 'Password is too weak. It must meet at least 3 requirements.' });
  }
  
  try {
    const domainDoc = doc(db, 'domains', subdomain);
    const domainSnap = await getDoc(domainDoc);

    if (domainSnap.exists()) {
      return res.status(400).json({ error: 'Subdomain already taken.' });
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Send email verification
    await sendEmailVerification(user, {
      url: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
      handleCodeInApp: false
    });

    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      createdAt: new Date(),
      subdomain,
      emailVerified: false
    });

    await setDoc(domainDoc, {
      uid: user.uid,
      published: true
    });

    // Create a default service for the new user
    const servicesRef = collection(db, 'users', user.uid, 'services');
    await addDoc(servicesRef, {
      title: "Sample Service",
      description: "This is a sample service to help you get started. You can delete it anytime.",
      location: "Online",
      cost: "50",
      duration: "60",
      availability: {
        startTime: "09:00",
        endTime: "17:00"
      },
      createdAt: new Date()
    });

    res.status(201).json({
      message: 'User created successfully. Please verify your email.',
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
    const user = userCredential.user;
    
    if (!user.emailVerified) {
      // Send them to verify-email page instead of responding with an error
      await sendEmailVerification(user, {
        url: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
        handleCodeInApp: false
      });
      
      return res.status(200).json({
        verified: false,
        redirect: '/verify-email'
      });
    }
    
    res.status(200).json({
      message: 'Login successful',
      user: userCredential.user,
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Find user by email (if they're not logged in)
    const user = auth.currentUser;
    
    if (user) {
      if (user.email !== email) {
        return res.status(400).json({ error: 'Email does not match the logged-in user' });
      }
      
      if (user.emailVerified) {
        return res.status(400).json({ error: 'Email is already verified' });
      }
      
      await sendEmailVerification(user, {
        url: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
        handleCodeInApp: false
      });
      
      return res.status(200).json({ message: 'Verification email sent' });
    } else {
      return res.status(401).json({ error: 'User not logged in. Please login first.' });
    }
  } catch (error) {
    console.error('Error sending verification email:', error);
    res.status(500).json({ error: error.message });
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

// Get bookings for a specific date
router.get('/api/bookings/:subdomain/:date', async (req, res) => {
    try {
        const { subdomain, date } = req.params;
        
        // Get the domain document to find the owner's UID
        const domainDoc = await getDoc(doc(db, 'domains', subdomain));
        if (!domainDoc.exists()) {
            return res.status(404).json({ error: 'Domain not found' });
        }
        const ownerUid = domainDoc.data().uid;

        // Get bookings for this owner and date
        const bookingsRef = collection(db, 'users', ownerUid, 'bookings');
        const q = query(bookingsRef, where('date', '==', date));
        const bookingsSnap = await getDocs(q);
        
        const bookings = [];
        bookingsSnap.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
        });

        res.json(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark booking as complete
router.post('/api/bookings/:id/complete', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
      const { id } = req.params;
      const bookingRef = doc(db, 'users', user.uid, 'bookings', id);
      await updateDoc(bookingRef, {
          status: 'completed',
          completedAt: new Date()
      });
      res.json({ success: true });
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

// Get a single booking by ID
router.get('/api/bookings/:id', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { id } = req.params;
        const bookingRef = doc(db, 'users', user.uid, 'bookings', id);
        const bookingSnapshot = await getDoc(bookingRef);
        
        if (!bookingSnapshot.exists()) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ id: bookingSnapshot.id, ...bookingSnapshot.data() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel a booking
router.post('/api/bookings/:id/cancel', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { id } = req.params;
        const bookingRef = doc(db, 'users', user.uid, 'bookings', id);
        const bookingSnapshot = await getDoc(bookingRef);
        
        if (!bookingSnapshot.exists()) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        await updateDoc(bookingRef, {
            status: 'cancelled',
            cancelledAt: new Date()
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reschedule a booking
router.post('/api/bookings/:id/reschedule', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { id } = req.params;
        const { date, time } = req.body;
        
        if (!date || !time) {
            return res.status(400).json({ error: 'Date and time are required' });
        }
        
        const bookingRef = doc(db, 'users', user.uid, 'bookings', id);
        const bookingSnapshot = await getDoc(bookingRef);
        
        if (!bookingSnapshot.exists()) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        await updateDoc(bookingRef, {
            date,
            time,
            rescheduledAt: new Date()
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new booking
router.post('/api/bookings', async (req, res) => {
    const {
        serviceId,
        date,
        time,
        clientName,
        clientEmail,
        clientPhone,
        notes,
        serviceName,
        cost,
        duration
    } = req.body;

    try {
        // Get the subdomain from the referer URL
        const referer = req.headers.referer;
        const subdomain = referer.split('/')[3]; // This gets the subdomain from the URL

        // Get the domain document to find the owner's UID
        const domainDoc = await getDoc(doc(db, 'domains', subdomain));
        if (!domainDoc.exists()) {
            throw new Error('Domain not found');
        }
        const ownerUid = domainDoc.data().uid;

        // Create the booking in the owner's bookings collection
        const bookingRef = collection(db, 'users', ownerUid, 'bookings');
        await addDoc(bookingRef, {
            serviceId,
            serviceName,
            date,
            time,
            clientName,
            clientEmail,
            clientPhone,
            notes,
            cost,
            duration,
            status: 'pending',
            createdAt: new Date()
        });

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ error: error.message });
    }
});

// Confirmation page route
router.get('/:subdomain/confirm-booking', async (req, res) => {
    const { subdomain } = req.params;
    
    try {
        const domainDoc = await getDoc(doc(db, 'domains', subdomain));
        
        if (domainDoc.exists()) {
            res.render('confirm-booking', {
                theme: domainDoc.data().theme || 'light'
            });
        } else {
            res.status(404).render('404');
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).render('error');
    }
});

// Get analytics data
router.get('/api/analytics', async (req, res) => {
    const user = auth.currentUser;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { period } = req.query;
    const currentDate = new Date();
    let startDate;

    if (period === '30') {
        startDate = new Date();
        startDate.setDate(currentDate.getDate() - 30);
    } else if (period === 'lifetime') {
        // Get user's creation date as start date
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        startDate = userDoc.data().createdAt.toDate();
    } else {
        return res.status(400).json({ error: 'Invalid period parameter' });
    }

    try {
        // Get all bookings for the user
        const bookingsRef = collection(db, 'users', user.uid, 'bookings');
        const bookingsSnap = await getDocs(bookingsRef);
        
        // Process bookings data
        const bookings = [];
        let totalRevenue = 0;
        let totalBookings = 0;
        const serviceBookings = {};
        const dailyBookings = {};
        const dailyRevenue = {};
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const currentDateStr = currentDate.toISOString().split('T')[0];
        
        bookingsSnap.forEach(doc => {
            const booking = doc.data();
            const bookingDate = booking.date; // Already a string in YYYY-MM-DD format
            
            // Only process bookings within the date range
            if (bookingDate >= startDateStr) {
                // Add to bookings array (for recent bookings)
                bookings.push({
                    id: doc.id,
                    clientName: booking.clientName,
                    serviceName: booking.serviceName,
                    date: new Date(booking.date),
                    amount: parseFloat(booking.cost) || 0, // Convert cost to amount
                    status: booking.status
                });
                
                // Update totals
                if (booking.status !== 'cancelled') {
                    totalRevenue += parseFloat(booking.cost) || 0;
                    totalBookings++;
                    
                    // Update service bookings count
                    serviceBookings[booking.serviceName] = (serviceBookings[booking.serviceName] || 0) + 1;
                    
                    // Update daily stats
                    dailyBookings[bookingDate] = (dailyBookings[bookingDate] || 0) + 1;
                    dailyRevenue[bookingDate] = (dailyRevenue[bookingDate] || 0) + (parseFloat(booking.cost) || 0);
                }
            }
        });

        // Calculate previous period
        const periodDays = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
        const previousStartDate = new Date(startDate);
        previousStartDate.setDate(previousStartDate.getDate() - periodDays);
        const previousStartDateStr = previousStartDate.toISOString().split('T')[0];
        
        let previousTotalRevenue = 0;
        let previousTotalBookings = 0;
        let previousNewClients = new Set();
        
        bookingsSnap.forEach(doc => {
            const booking = doc.data();
            if (booking.date >= previousStartDateStr && booking.date < startDateStr) {
                if (booking.status !== 'cancelled') {
                    previousTotalRevenue += parseFloat(booking.cost) || 0;
                    previousTotalBookings++;
                    previousNewClients.add(booking.clientEmail);
                }
            }
        });

        // Calculate changes
        const revenueChange = previousTotalRevenue === 0 ? 100 : 
            Math.round(((totalRevenue - previousTotalRevenue) / previousTotalRevenue) * 100);
        const bookingsChange = previousTotalBookings === 0 ? 100 : 
            Math.round(((totalBookings - previousTotalBookings) / previousTotalBookings) * 100);

        // Get unique clients
        const newClients = new Set();
        const existingClients = new Set();
        
        // First, get all clients from previous periods to identify truly new ones
        bookingsSnap.forEach(doc => {
            const booking = doc.data();
            if (booking.date < startDateStr) {
                existingClients.add(booking.clientEmail);
            }
        });

        // Now count only clients that weren't in previous periods
        bookings.forEach(booking => {
            if (!existingClients.has(booking.clientEmail)) {
                newClients.add(booking.clientEmail);
            }
        });

        const clientsChange = previousNewClients.size === 0 ? 100 : 
            Math.round(((newClients.size - previousNewClients.size) / previousNewClients.size) * 100);

        // Calculate conversion rate (completed bookings / total bookings, excluding cancelled)
        const activeBookings = bookings.filter(b => b.status !== 'cancelled').length;
        const completedBookings = bookings.filter(b => b.status === 'completed').length;
        const conversionRate = activeBookings === 0 ? 0 : Math.round((completedBookings / activeBookings) * 100);
        
        const previousActiveBookings = Array.from(bookingsSnap.docs)
            .filter(doc => {
                const data = doc.data();
                return data.date >= previousStartDateStr && 
                       data.date < startDateStr && 
                       data.status !== 'cancelled';
            }).length;
            
        const previousCompletedBookings = Array.from(bookingsSnap.docs)
            .filter(doc => {
                const data = doc.data();
                return data.date >= previousStartDateStr && 
                       data.date < startDateStr && 
                       data.status === 'completed';
            }).length;
            
        const previousConversionRate = previousActiveBookings === 0 ? 0 : 
            Math.round((previousCompletedBookings / previousActiveBookings) * 100);
        const conversionChange = previousConversionRate === 0 ? 100 : 
            Math.round(((conversionRate - previousConversionRate) / previousConversionRate) * 100);

        // Prepare time series data
        const dates = [];
        let currentDateIter = new Date(startDate);
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30); // Include 30 days into the future
        
        while (currentDateIter <= futureDate) {
            dates.push(currentDateIter.toISOString().split('T')[0]);
            currentDateIter.setDate(currentDateIter.getDate() + 1);
        }

        // Format response data
        const response = {
            summary: {
                totalBookings,
                bookingsChange,
                totalRevenue,
                revenueChange,
                newClients: newClients.size,
                clientsChange,
                conversionRate,
                conversionChange
            },
            recentBookings: bookings.sort((a, b) => b.date - a.date).slice(0, 5),
            popularServices: Object.entries(serviceBookings)
                .map(([name, bookings]) => ({ name, bookings }))
                .sort((a, b) => b.bookings - a.bookings)
                .slice(0, 5),
            revenueData: {
                labels: dates,
                values: dates.map(date => dailyRevenue[date] || 0)
            },
            bookingTrends: {
                labels: dates,
                values: dates.map(date => dailyBookings[date] || 0)
            }
        };

        res.json(response);
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
});

// Logout Route
router.post('/logout', async (req, res) => {
  try {
    await signOut(auth);
    res.redirect('/login');
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).render('error', { message: 'Failed to logout. Please try again.' });
  }
});

// Update user profile
router.post('/api/user/profile', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
      const { email } = req.body;
      
      // Update email in Firebase Auth
      await updateEmail(user, email);
      
      // Update email in Firestore
      await updateDoc(doc(db, 'users', user.uid), {
          email: email
      });
      
      res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
      console.error('Error updating profile:', error);
      let errorMessage = error.message;
      
      // Provide more user-friendly error messages
      if (error.code === 'auth/requires-recent-login') {
          errorMessage = 'For security reasons, please log out and log back in before changing your email';
      }
      
      res.status(500).json({ error: errorMessage });
  }
});

// Update user password
router.post('/api/user/password', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
      const { currentPassword, newPassword } = req.body;
      
      // Re-authenticate user before password change
      const credential = EmailAuthProvider.credential(
          user.email, 
          currentPassword
      );
      
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
      console.error('Error updating password:', error);
      let errorMessage = error.message;
      
      // Provide more user-friendly error messages
      if (error.code === 'auth/wrong-password') {
          errorMessage = 'The current password is incorrect';
      } else if (error.code === 'auth/requires-recent-login') {
          errorMessage = 'For security reasons, please log out and log back in before changing your password';
      } else if (error.code === 'auth/weak-password') {
          errorMessage = 'The new password is too weak. Please choose a stronger password';
      }
      
      res.status(500).json({ error: errorMessage });
  }
});

// Update user subdomain
router.post('/api/user/subdomain', async (req, res) => {
  const user = auth.currentUser;
  if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
      const { newSubdomain } = req.body;
      
      // Check if the new subdomain is available
      const domainDoc = doc(db, 'domains', newSubdomain);
      const domainSnap = await getDoc(domainDoc);
      
      if (domainSnap.exists()) {
          return res.status(400).json({ error: 'Subdomain already taken' });
      }
      
      // Get the current subdomain
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const currentSubdomain = userDoc.data().subdomain;
      
      // Delete the old domain document
      await deleteDoc(doc(db, 'domains', currentSubdomain));
      
      // Create the new domain document
      await setDoc(domainDoc, {
          uid: user.uid,
          published: true
      });
      
      // Update the user's subdomain
      await updateDoc(doc(db, 'users', user.uid), {
          subdomain: newSubdomain
      });
      
      res.json({ success: true });
  } catch (error) {
      console.error('Error updating subdomain:', error);
      res.status(500).json({ error: error.message });
  }
});

// Route to force refresh the user's email verification status (GET method)
router.get('/refresh-verification', async (req, res) => {
  try {
    console.log("Refresh verification requested (GET)");
    const user = auth.currentUser;
    
    if (!user) {
      console.log("No current user found, redirecting to login");
      return res.redirect('/login');
    }
    
    console.log(`Current user found: ${user.email}, emailVerified=${user.emailVerified}`);
    
    // Force reload the user to get updated verification status
    await user.reload();
    console.log(`After reload: emailVerified=${user.emailVerified}`);
    
    // Check Firebase verification status
    if (user.emailVerified) {
      console.log("Email is verified in Firebase Auth");
      // Update Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        emailVerified: true
      });
      console.log("Updated Firestore with verified status");
      
      // Redirect to dashboard
      return res.redirect('/dashboard/overview');
    } else {
      // Check status in Firestore as fallback
      console.log("Email not verified in Firebase Auth, checking Firestore");
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (userDoc.exists() && userDoc.data().emailVerified) {
        console.log("Email verified in Firestore, redirecting to dashboard");
        return res.redirect('/dashboard/overview');
      }
      
      // Force token refresh as a last resort to update auth state
      try {
        console.log("Attempting to force token refresh");
        await user.getIdToken(true);
        await user.reload();
        
        if (user.emailVerified) {
          console.log("Email verified after token refresh");
          await updateDoc(doc(db, 'users', user.uid), {
            emailVerified: true
          });
          return res.redirect('/dashboard/overview');
        }
        
        console.log("Still not verified after token refresh");
      } catch (tokenError) {
        console.error("Error refreshing token:", tokenError);
      }
    }
    
    // If still not verified, redirect back to verify-email
    console.log("User still not verified, redirecting back to verify-email");
    res.redirect('/verify-email?refresh=' + Date.now());
  } catch (error) {
    console.error('Error refreshing verification status:', error);
    res.redirect('/login');
  }
});

// POST version of the refresh-verification route
router.post('/refresh-verification', async (req, res) => {
  try {
    console.log("Refresh verification requested (POST)");
    const user = auth.currentUser;
    
    if (!user) {
      console.log("No current user found, redirecting to login");
      return res.redirect('/login');
    }
    
    console.log(`Current user found: ${user.email}, emailVerified=${user.emailVerified}`);
    
    // Force token refresh to get latest verification status
    try {
      await user.getIdToken(true); // Force refresh token
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
      await user.reload(); // Reload user data after token refresh
      
      console.log(`After token refresh and reload: emailVerified=${user.emailVerified}`);
    } catch (refreshError) {
      console.error("Error refreshing token:", refreshError);
    }
    
    // Verify email verification status manually with Firebase Admin
    if (user.emailVerified) {
      console.log("User verified successfully");
      // Update Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        emailVerified: true
      });
      
      // Redirect to dashboard
      return res.redirect('/dashboard/overview');
    }
    
    // Check Firestore as a fallback
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists() && userDoc.data().emailVerified) {
      return res.redirect('/dashboard/overview');
    }
    
    // If still not verified, redirect back to verify-email
    console.log("User still not verified after all checks");
    res.redirect('/verify-email?refresh=' + Date.now());
  } catch (error) {
    console.error('Error in POST refresh-verification:', error);
    res.redirect('/verify-email');
  }
});

// Password reset route
router.post('/reset-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Send password reset email
    await sendPasswordResetEmail(auth, email, {
      url: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
      handleCodeInApp: false
    });
    
    // Always return success, even if email doesn't exist for security reasons
    res.status(200).json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error('Error sending password reset email:', error);
    // Still return success to avoid revealing if an email exists or not
    res.status(200).json({ message: 'If your email exists in our system, you will receive a password reset link' });
  }
});

// Handle password reset action
router.get('/password-reset', (req, res) => {
  const { mode, oobCode } = req.query;
  
  if (mode === 'resetPassword' && oobCode) {
    // Render password reset page with the oobCode
    res.render('password-reset', { oobCode });
  } else {
    res.status(400).render('error', { message: 'Invalid password reset link' });
  }
});

// Handle password reset confirmation
router.post('/confirm-reset-password', async (req, res) => {
  const { oobCode, newPassword } = req.body;
  
  if (!oobCode || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Validate password strength
  const passwordStrengthRegex = {
    minLength: newPassword.length >= 8,
    hasUpperCase: /[A-Z]/.test(newPassword),
    hasLowerCase: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)
  };
  
  const passedChecks = Object.values(passwordStrengthRegex).filter(Boolean).length;
  if (passedChecks < 3) {
    return res.status(400).json({ error: 'Password is too weak. It must meet at least 3 requirements.' });
  }
  
  try {
    // Complete the password reset
    await confirmPasswordReset(auth, oobCode, newPassword);
    
    // Return success response
    res.status(200).json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Error confirming password reset:', error);
    
    let errorMessage = 'Failed to reset password. Please try again.';
    
    // Provide more specific error messages
    if (error.code === 'auth/invalid-action-code') {
      errorMessage = 'The reset link has expired or has already been used.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'The password is too weak. Please choose a stronger password.';
    } else if (error.code === 'auth/user-not-found') {
      errorMessage = 'User account not found.';
    }
    
    res.status(400).json({ error: errorMessage });
  }
});

router.get('*', (req, res) => {
  res.status(404).render('404');
});

module.exports = router;