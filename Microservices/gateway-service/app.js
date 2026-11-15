const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
const port = process.env.PORT || 3003;

const USER_URL = process.env.USER_SERVICE_URL || 'http://user-service:3000';
const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const ORDER_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3002';

app.get('/health', (req, res) => {
  res.json({ status: 'Gateway Service is healthy' });
});

const proxyGet = (path, base, errMsg) => async (req, res) => {
  try {
    const response = await axios.get(`${base}${path}`);
    res.json(response.data);
  } catch (error) {
    console.error(errMsg, error.message);
    res.status(500).json({ error: errMsg });
  }
};

app.get('/api/users', proxyGet('/users', USER_URL, 'Error fetching users'));
app.get('/api/products', proxyGet('/products', PRODUCT_URL, 'Error fetching products'));
app.get('/api/orders', proxyGet('/orders', ORDER_URL, 'Error fetching orders'));

app.post('/api/orders', async (req, res) => {
  try {
    const response = await axios.post(`${ORDER_URL}/orders`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('Error creating order', error.message);
    res.status(500).json({ error: 'Error creating order' });
  }
});

app.listen(port, () => {
  console.log(`Gateway service running on port ${port}`);
});