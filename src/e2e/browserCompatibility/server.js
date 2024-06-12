var express = require('express');
var app = express();
var path = require('path');

//app.use(express.static(__dirname)); // Current directory is root
app.use(express.static(path.join(__dirname))); //  "public" off of current is root

app.listen(3334);
console.log('Listening on port 3334');
