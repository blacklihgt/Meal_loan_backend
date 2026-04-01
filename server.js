//const express = require('express');
//const mysql = require('mysql2');
//const bcrypt = require('bcryptjs');
//const morgan = require('morgan');
//const cors = require('cors');
//const { Sequelize, DataTypes } = require('sequelize');

import express from 'express';
import bcrypt from 'bcryptjs';
import morgan from 'morgan';
import cors from 'cors';
import {Sequelize, DataTypes} from 'sequelize';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pkg from 'pg';

const {Pool} = pkg;
dotenv.config();

//require('dotenv').config();

//const jwt = require('jsonwebtoken');

//const PORT = 3307;
const JWT_SECRET_KEY = process.env.JWT_SECRET; //|| 'your-super-secret-key'; // Use env var!

const app = express();

// Middleware
app.use(cors({
  origin: 'https://meal-loan-react.vercel.app',  // ← your frontend URL (no trailing slash)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],  // include OPTIONS
  allowedHeaders: ['Content-Type', 'Authorization'],     // add any custom headers you use
  credentials: true,   // if using cookies/sessions/auth tokens
}));
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

// Define models
const Users = sequelize.define('Users', {
  id_number: {
    type: DataTypes.STRING,
    primaryKey: true,
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'Users',
  freezeTableName: true,
  timestamps: true  // Adds createdAt and updatedAt
});

const Clients = sequelize.define('Clients', {
  id_no: {
    type: DataTypes.STRING,
    unique: true,
    primaryKey: true,
    allowNull: false
  },
  full_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone_number: {
    type: DataTypes.INTEGER
  }
}, {
  tableName: 'Clients',
  freezeTableName: true,
  timestamps: true
});

const Loans = sequelize.define('Loans', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  id_number: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'Clients',
      key: 'id_no'
    }
  }
}, {
  tableName: 'Loans',
  freezeTableName: true,
  timestamps: true
});

// Define the available_amount table (not through Sequelize model)
// We'll create it manually if it doesn't exist

// Function to create available_amount table if it doesn't exist
async function createAvailableAmountTable() {
  try {
    // Check if table exists
    const tableExists = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'available_amount'
      );
    `);
    
    if (!tableExists[0][0].exists) {
      console.log('Creating available_amount table...');
      await sequelize.query(`
        CREATE TABLE available_amount (
          id_no VARCHAR(255) PRIMARY KEY,
          amount INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (id_no) REFERENCES "Clients"(id_no) ON DELETE CASCADE
        );
      `);
      console.log('available_amount table created successfully');
    } else {
      console.log('available_amount table already exists');
    }
  } catch (error) {
    console.error('Error creating available_amount table:', error);
    throw error;
  }
}

// Function to initialize database tables
async function initializeDatabase() {
  try {
    // Test the connection
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Sync all Sequelize models (creates tables if they don't exist)
    // { force: false } ensures existing tables are not dropped
    await sequelize.sync({ alter: false, force: false });
    console.log('Sequelize models synchronized (tables created if not existing)');

    // Create available_amount table if it doesn't exist
    await createAvailableAmountTable();
    
    console.log('All tables are ready');
    
    // Optional: Insert default test user if needed
    await insertDefaultTestUser();
    
  } catch (error) {
    console.error('Unable to initialize database:', error);
    process.exit(1); // Exit if database initialization fails
  }
}

// Optional: Insert a default test user for development
async function insertDefaultTestUser() {
  try {
    const testUser = await Users.findOne({
      where: { id_number: '36933538' }
    });
    
    if (!testUser) {
      console.log('Creating default test user...');
      await Users.create({
        id_number: '36933538',
        password: 'assword123'  // Plain text password for development
      });
      console.log('Default test user created');
    } else {
      console.log('Test user already exists');
    }
  } catch (error) {
    console.error('Error creating test user:', error);
    // Don't throw error, just log it
  }
}

// ==================== LOGIN ====================
app.post('/login', async (req, res) => {
  const { idNumber, password } = req.body;
  console.log(req.body)

  if (!idNumber || !password) {
    return res.status(400).json({ error: 'ID and password required' });
  }

  try {
    const user = await Users.findOne({
      where: { id_number: idNumber }
    });

    if (!user || password !== user.password) {
      console.log('Login failed');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id_number },
      JWT_SECRET_KEY,
      { expiresIn: '1h' }
    );

    console.log('Login successful for', user.id_number);
    return res.status(200).json({ message: 'Login successful', token });
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
  console.log('Request body: ', req.body)

  if (!id_number || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid clientId and positive amount required' });
  }

  const transaction = await sequelize.transaction();
 
  try {
    console.log("Transaction has begun")

    // Lock and read current amount
    const rows = await sequelize.query(
      `SELECT amount FROM available_amount WHERE id_no = :id_number FOR UPDATE`,
      {
        replacements: { id_number },
        type: Sequelize.QueryTypes.SELECT,
        transaction
      }
    );

    if (rows.length === 0) {
      throw new Error("Client not found");
    }
    
    // Log available amount
    const availableAmount = rows[0].amount;
    console.log("Available amount is:", availableAmount)

    // Compute new amount
    const newAvailableAmount = availableAmount - amount;
    console.log("New Available amount is:", newAvailableAmount)

    if (newAvailableAmount < 0) {
      throw new Error("Insufficient available amount");
    }

    await sequelize.query(
      `UPDATE available_amount
       SET amount = :newAmount
       WHERE id_no = :id_number`,
      {
        replacements: {
          newAmount: newAvailableAmount,
          id_number
        },
        transaction
      }
    );

    await Loans.create({
      id_number: id_number,
      amount: amount
    }, { transaction });

    await transaction.commit();
    console.log("Transaction committed");

    return res.json({
      status: "success",
      message: "Loan approved",
      previousAmount: availableAmount,
      remainingAmount: newAvailableAmount
    });

  } catch (err) {
    // Rollback on error
    await transaction.rollback();
    console.error("Transaction rolled back:", err.message);

    return res.status(400).json({
      status: "error",
      message: err.message
    });
  }
});

// Get all loans
app.get('/loans', authenticateJWT, async (req, res) => {
  try {
    const loans = await Loans.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(loans);
  } catch (err) {
    console.error('Error fetching loans:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// Start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on render ${PORT}`);
  });
});