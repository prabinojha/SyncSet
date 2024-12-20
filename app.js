const express = require('express');
const bodyParser = require('body-parser');
const routes = require('./routes/routes');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'ejs');

app.use(routes);

app.listen(3000);