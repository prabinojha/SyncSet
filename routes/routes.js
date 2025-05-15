const express = require('express');
const { auth, db } = require('../firebase');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = require('firebase/auth');
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
  const user = auth.currentUser;
  res.render('home', { user, isHomePage: true });
});

router.get('/dashboard/:section?', async (req, res) => {
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
      await user.updateEmail(email);
      
      // Update email in Firestore
      await updateDoc(doc(db, 'users', user.uid), {
          email: email
      });
      
      res.json({ success: true });
  } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ error: error.message });
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
      const credential = require('firebase/auth').EmailAuthProvider.credential(
          user.email, 
          currentPassword
      );
      
      await require('firebase/auth').reauthenticateWithCredential(user, credential);
      
      // Update password
      await user.updatePassword(newPassword);
      
      res.json({ success: true });
  } catch (error) {
      console.error('Error updating password:', error);
      res.status(500).json({ error: error.message });
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
          published: userDoc.data().published || false
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

router.get('*', (req, res) => {
  res.status(404).render('404');
});

module.exports = router;