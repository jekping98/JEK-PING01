const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database (Ganti dengan MongoDB/PostgreSQL untuk production)
let activeOrders = [];
let drivers = {};
let platformWallet = 6780000; // Saldo komisi awal

io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // DRIVER ONLINE
    socket.on('driver:goOnline', (data) => {
        drivers[socket.id] = { ...data, socketId: socket.id, status: 'online', lastUpdate: Date.now() };
        io.emit('admin:driversUpdate', Object.values(drivers));
        console.log(`🛵 Driver Online: ${data.name}`);
    });

    // USER BUAT ORDER
    socket.on('user:createOrder', (orderData) => {
        const newOrder = {
            id: 'JP-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
            ...orderData,
            status: 'waiting',
            createdAt: new Date().toISOString()
        };
        
        activeOrders.push(newOrder);
        
        // Broadcast ke semua driver online
        io.emit('driver:newOrder', newOrder);
        
        // Update admin dashboard
        io.emit('admin:newOrder', newOrder);
        
        // Tambah komisi ke dompet platform
        const commission = Math.ceil(orderData.fare * 0.15);
        platformWallet += commission;
        io.emit('admin:walletUpdate', platformWallet);
        
        console.log(`📦 New Order: ${newOrder.id} | Fare: Rp ${orderData.fare.toLocaleString()} | Commission: Rp ${commission.toLocaleString()}`);
    });

    // DRIVER ACCEPT ORDER
    socket.on('driver:acceptOrder', ({ orderId, driverId }) => {
        const order = activeOrders.find(o => o.id === orderId);
        if (order && order.status === 'waiting') {
            order.status = 'accepted';
            order.driverId = driverId;
            order.driverName = drivers[driverId]?.name || 'Unknown';
            
            // Notify user
            io.emit('user:orderAccepted', order);
            
            // Remove from available orders for other drivers
            io.emit('driver:orderTaken', orderId);
            
            console.log(`✅ Order ${orderId} accepted by ${order.driverName}`);
        }
    });

    // DRIVER UPDATE GPS LOCATION (Every 3 seconds)
    socket.on('driver:updateLocation', (locationData) => {
        if (drivers[socket.id]) {
            drivers[socket.id].lat = locationData.lat;
            drivers[socket.id].lng = locationData.lng;
            drivers[socket.id].lastUpdate = Date.now();
            
            // Send to specific user who has active order with this driver
            const myOrder = activeOrders.find(o => o.driverId === socket.id && o.status === 'accepted');
            if (myOrder) {
                io.emit('user:driverMoved', {
                    orderId: myOrder.id,
                    lat: locationData.lat,
                    lng: locationData.lng,
                    speed: locationData.speed || 0
                });
            }
        }
    });

    // ADMIN WITHDRAW COMMISSION
    socket.on('admin:withdraw', (amount) => {
        if (amount > 0 && amount <= platformWallet) {
            platformWallet -= amount;
            io.emit('admin:walletUpdate', platformWallet);
            io.emit('admin:withdrawSuccess', { amount, date: new Date().toISOString() });
            console.log(` Admin Withdraw: Rp ${amount.toLocaleString()}`);
        }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        delete drivers[socket.id];
        io.emit('admin:driversUpdate', Object.values(drivers));
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 JEK-PING Server running on port ${PORT}`);
    console.log(`📱 Access at: http://localhost:${PORT}`);
});