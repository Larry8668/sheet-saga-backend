const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello from the server!');
});

app.post('/api/sync', (req, res) => {
  const { range, value, sheetName, timestamp } = req.body;

  console.log(`Change detected in ${sheetName} at ${range}: ${value} at ${timestamp}`);

  res.status(200).send('Data received');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
