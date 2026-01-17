//const express = require('express');
//const mysql = require('mysql2');
//const bcrypt = require('bcryptjs');
//const morgan = require('morgan');
//const cors = require('cors');
//const { Sequelize, DataTypes } = require('sequelize');

import express from 'express';
import mysql2 from 'mysql2';
import bcrypt from 'bcryptjs';
import morgan from 'morgan';
import cors from 'cors';
import {Sequelize, DataTypes} from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

//require('dotenv').config();

//const jwt = require('jsonwebtoken');

//const PORT = 3307;
//const JWT_SECRET_KEY = process.env.JWT_SECRET; //|| 'your-super-secret-key'; // Use env var!

const app = express();

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'https://meal-loan-react.vercel.app'] })); // Adjust to your frontend URL
app.use(morgan('dev'));
app.use(express.json());

// Use the full DATABASE_URL that Render provides
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,                  // disable SQL query logs in production
  dialectOptions: {
    // Render requires SSL for both internal and external connections
    ssl: {
      require: true,
      rejectUnauthorized: false   // needed because Render uses a self-signed cert chain
    }
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});


//Test the connection
(async () => {
  try {
    await sequelize.authenticate();
    console.log('Sequelize connected to MySQL');
  } catch (error) {
    console.error('Unable to connect:', error);
  }
})();

const Users = sequelize.define('Users', {
  id_number: {type: DataTypes.INTEGER, primaryKey: true, unique:true},
  password: {type: DataTypes.STRING },
  date_created: {type: DataTypes.DATE}
})
//module.exports = Users;


const Loans = sequelize.define('Loans', {
  date_created: {type: DataTypes.DATE},
  amount: {type: DataTypes.INTEGER},

  id_number: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Clients',
      key: 'id_no'
    }
  }


})

const clients = sequelize.define('Clients', {
  id_no: {type: DataTypes.INTEGER, unique: true},
  full_name: {type: DataTypes.STRING},
  phone_number: {type: DataTypes.INTEGER},
  date_created: {type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false}

})

await sequelize.sync({ alter: true});//dev only

// MySQL Connection Pool (better for production)
//const pool = mysql.createPool({
  //host: 'localhost',         // or your MySQL host
  //user: 'root',              // your MySQL user
  //password: '@Roykibet012',  // your MySQL password
  //database: 'pilot',
  //waitForConnections: true,
  //connectionLimit: 10,
  //queueLimit: 0
//});

//const db = pool.promise(); // Enables async/await

// Test connection on startup
//db.query('SELECT 1')
  //.then(() => console.log('Connected to MySQL database'))
  //.catch(err => console.error('MySQL connection failed:', err));

// Optional: Create default admin user on startup (for MVP)

async function createDefaultUser() {
  const id_number = '36933538';
  const plainPassword = 'password123';
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);

   try {
    await sequelize.query(
      `
      INSERT INTO "Users" (id_number, password)
      VALUES (:id_number, :password)
      ON CONFLICT (id_number) DO NOTHING
      `,
      {
        replacements: {
          id_number,
          password: hashedPassword,
        },
      }
    );

    console.log('Default user created (or already exists)');
  } catch (err) {
    console.error('Error creating default user:', err);
  }
}

createDefaultUser();

// ==================== LOGIN ====================
app.post('/login', async (req, res) => {
  const { idNumber, password } = req.body;
  console.log(req.body)

  if (!idNumber || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
const [rows] = await sequelize.query(
  'SELECT * FROM "Users" WHERE id_number = :idNumber',
  {
    replacements: { idNumber },
    type: Sequelize.QueryTypes.SELECT,
  }
);

const user = rows;



    if (!user || !bcrypt.compareSync(password, user.password)) {
      console.log('Login failed:');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id},
      JWT_SECRET_KEY,
      { expiresIn: '24h' }
    );

    console.log('Login successful:');
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== JWT MIDDLEWARE ====================
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied: No token' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      console.log('Invalid token attempt');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
};

// ==================== LOAN ENDPOINTS ====================

// Create loan
app.post('/loans', authenticateJWT, async (req, res) => {
  const { id_number, amount } = req.body;

  if (!id_number || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid clientId and positive amount required' });
  }

  const connection = await db.getConnection();

try {
  await connection.beginTransaction();

  console.log("Transaction has begun")

  // 1️⃣ Read & lock balance
  const [rows] = await connection.query(
    `SELECT amount
     FROM available_amount
     WHERE id_number = ?
     FOR UPDATE`,
    [id_number]
  );

  if (rows.length === 0) {
    throw new Error("Client not found");
    
  }

  const availableAmount = rows[0].amount;
  console.log("Available amount is:", availableAmount)

  // 2️⃣ Compute
  const newAvailableAmount = availableAmount - amount;
  console.log("Available amount is:", newAvailableAmount)

  if (newAvailableAmount < 0) {
    throw new Error("Insufficient available amount");
  }

  // 3️⃣ Update balance
  await connection.query(
    `UPDATE available_amount
     SET amount = ?
     WHERE id_number = ?`,
    [newAvailableAmount, id_number]
  );

  // 4️⃣ Insert loan
  await connection.query(
    `INSERT INTO loans (id_number, amount)
     VALUES (?, ?)`,
    [id_number, amount]
  );

  await connection.commit();

  const db_response = res.json({
    status: "success",
    message: "Loan approved",
    previousAmount: availableAmount,
    remainingAmount: newAvailableAmount
  });

  console.log(db_response)

} catch (err) {
  await connection.rollback();

  res.status(400).json({
    status: "error",
    message: err.message
  });
  console.log("QUERY COMPLETED")
  

} finally {
  connection.release();
  console.log("CONNECTION RELEASED")
}


 
});

// Get all loans
app.get('/api/loans', authenticateJWT, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, clientId, amount, created_at AS createdAt FROM loans ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching loans:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// Start server
const PORT = process.env.PORT || 5432;
app.listen(PORT, () => {
  console.log(`Server running on render${PORT}`);
  console.log(`Login: admin@example.com / password123`);
});