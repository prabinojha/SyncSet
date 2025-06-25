const express = require('express');
const bodyParser = require('body-parser');
const routes = require('./routes/routes');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use('/public', express.static('public'));

app.use(express.json());

app.set('view engine', 'ejs');

app.use(routes);

app.use(function (error, req, res, next) {
    res.status(500).render('500');
  });

app.listen(3000);