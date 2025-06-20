const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const routes = require('./routes/routes');

admin.initializeApp();

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use('/public', express.static(path.join(__dirname, "..", "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use('/', routes);

app.use(function (error, req, res, next) {
    console.error(error);
    res.status(500).render('500');
});

exports.api = functions.runWith({ invoker: 'public' }).https.onRequest(app);
