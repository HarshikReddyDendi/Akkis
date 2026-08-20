require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const app = express();
const db = new Database(path.join(__dirname, 'akkis.db'));
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '50kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

db.exec(`CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,service TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,message TEXT,status TEXT DEFAULT 'pending',notification_status TEXT DEFAULT 'pending',notification_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(date,time));CREATE TABLE IF NOT EXISTS hairstyles(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,category TEXT,description TEXT,price TEXT,photo TEXT,video TEXT);CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,customer TEXT,rating INTEGER,text TEXT);CREATE TABLE IF NOT EXISTS gallery(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,image TEXT)`);
try { db.exec('ALTER TABLE bookings ADD COLUMN email TEXT'); } catch {}
try { db.exec("ALTER TABLE bookings ADD COLUMN notification_status TEXT DEFAULT 'pending'"); } catch {}
try { db.exec('ALTER TABLE bookings ADD COLUMN notification_error TEXT'); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON bookings(date,time) WHERE status != 'cancelled'"); } catch (error) { console.error('Could not create booking slot index:', error.message); }
if (!db.prepare('SELECT 1 FROM hairstyles LIMIT 1').get()) [['Long Layers','women long'],['Bob Cut','women short'],['Butterfly Cut','women long'],['Curtain Bangs','women long'],['Fade Cut','men short'],['Crew Cut','men short'],['Textured Crop','men short'],['Layer Cut','women short']].forEach(([name,category]) => db.prepare('INSERT INTO hairstyles(name,category,description,price) VALUES(?,?,?,?)').run(name,category,'Add your description','₹___'));

const admin = (req,res,next) => { if (!adminKey || req.headers['x-admin-key'] !== adminKey) return res.status(401).json({error:'Unauthorized'}); next(); };
const adminLimiter = rateLimit({windowMs:15*60*1000,limit:60,message:{error:'Too many dashboard requests'}});
const mailer = process.env.SMTP_HOST && !process.env.SMTP_PASS?.startsWith('your-') ? nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}) : null;
const sms = process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && process.env.TWILIO_AUTH_TOKEN && !process.env.TWILIO_AUTH_TOKEN.startsWith('your-') ? twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN) : null;
const whatsapp = sms && process.env.WHATSAPP_FROM && !process.env.WHATSAPP_FROM.includes('XXXX') ? sms : null;
function clean(value,max=500){return typeof value==='string'?value.trim().slice(0,max):'';}
function cleanEmail(value){return clean(value,160).toLowerCase();}
function cleanPhone(value){return clean(value,30).replace(/[\s().-]/g,'');}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00`));}
function validTime(value){return /^\d{2}:\d{2}$/.test(value);}
function bookingData(body){return{name:clean(body.name,80),phone:cleanPhone(body.phone),email:cleanEmail(body.email),service:clean(body.service,100),date:clean(body.date,10),time:clean(body.time,5),message:clean(body.message,500)};}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function whatsappNumber(value){const digits=value.replace(/\D/g,'');return digits?`whatsapp:+${digits}`:'';}
function validateBooking(booking){if(!booking.name||!booking.phone||!validEmail(booking.email)||!booking.service||!validDate(booking.date)||!validTime(booking.time))return'Enter a valid name, phone, email, service, date, and time';if(Date.parse(`${booking.date}T${booking.time}`)<Date.now())return'Choose a future appointment time';return null;}
async function sendNotifications(tasks){if(!tasks.length)return{status:'not_configured',error:'Add valid notification credentials'};const results=await Promise.allSettled(tasks);const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason.message).join('; ');return failures?{status:'failed',error:failures}:{status:'sent',error:null};}
async function notifyBooking(booking,id){const ownerText=`New Akkis Salon booking #${id}: ${booking.name}, ${booking.phone}, ${booking.email}, ${booking.service}, ${booking.date} at ${booking.time}. ${booking.message}`;const tasks=[];if(mailer&&process.env.NOTIFICATION_EMAIL)tasks.push(mailer.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:process.env.NOTIFICATION_EMAIL,subject:`New booking #${id} - Akkis Salon`,text:ownerText}));if(sms&&process.env.NOTIFICATION_PHONE&&process.env.TWILIO_FROM)tasks.push(sms.messages.create({body:ownerText,from:process.env.TWILIO_FROM,to:process.env.NOTIFICATION_PHONE}));return sendNotifications(tasks);}
async function notifyCustomerConfirmation(booking,id){const customerText=`Hello ${booking.name}, your Akkis Salon appointment is confirmed.\n\nBooking: #${id}\nService: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time}\n\nWe look forward to seeing you.\n\nAkkis Salon, Hasthinapuram`;const tasks=[];if(mailer&&booking.email)tasks.push(mailer.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:booking.email,subject:'Your Akkis Salon appointment is confirmed',text:customerText}));if(whatsapp&&booking.phone)tasks.push(whatsapp.messages.create({body:customerText,from:process.env.WHATSAPP_FROM,to:whatsappNumber(booking.phone)}));return sendNotifications(tasks);}

app.get('/api/config',(req,res)=>res.json({whatsappNumber:process.env.WHATSAPP_NUMBER||'',location:'Hasthinapuram',phone:'+91 94402 17474',hours:'By appointment'}));
app.get('/api/hairstyles',(req,res)=>res.json(db.prepare('SELECT * FROM hairstyles').all()));
app.post('/api/hairstyles',admin,adminLimiter,(req,res)=>{const x=req.body;if(!clean(x.name)||!clean(x.category))return res.status(400).json({error:'Name and category required'});const result=db.prepare('INSERT INTO hairstyles(name,category,description,price,photo,video) VALUES(?,?,?,?,?,?)').run(clean(x.name,100),clean(x.category,100),clean(x.description),clean(x.price,30),clean(x.photo,1000),clean(x.video,1000));res.json({id:result.lastInsertRowid});});
app.patch('/api/hairstyles/:id',admin,adminLimiter,(req,res)=>{const price=clean(req.body.price,30);if(!price)return res.status(400).json({error:'Price required'});const result=db.prepare('UPDATE hairstyles SET price=? WHERE id=?').run(price,req.params.id);if(!result.changes)return res.status(404).json({error:'Hairstyle not found'});res.json({ok:true});});
app.delete('/api/hairstyles/:id',admin,adminLimiter,(req,res)=>{db.prepare('DELETE FROM hairstyles WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/gallery',(req,res)=>res.json(db.prepare('SELECT * FROM gallery ORDER BY id DESC').all()));
app.post('/api/gallery',admin,adminLimiter,(req,res)=>{const title=clean(req.body.title,100);const image=clean(req.body.image,1000);if(!image)return res.status(400).json({error:'Image URL required'});db.prepare('INSERT INTO gallery(title,image) VALUES(?,?)').run(title,image);res.json({ok:true});});
app.delete('/api/gallery/:id',admin,adminLimiter,(req,res)=>{db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/reviews',(req,res)=>res.json(db.prepare('SELECT * FROM reviews ORDER BY id DESC').all()));
app.post('/api/reviews',(req,res)=>{const customer=clean(req.body.customer,80);const text=clean(req.body.text,500);const rating=Number(req.body.rating);if(!customer||!text||!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Valid customer, rating, and review required'});db.prepare('INSERT INTO reviews(customer,rating,text) VALUES(?,?,?)').run(customer,rating,text);res.json({ok:true});});
app.delete('/api/reviews/:id',admin,adminLimiter,(req,res)=>{db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/availability',(req,res)=>{if(!validDate(req.query.date))return res.status(400).json({error:'Valid date required'});const booked=db.prepare("SELECT time FROM bookings WHERE date=? AND status != 'cancelled'").all(req.query.date).map(row=>row.time);res.json({date:req.query.date,booked});});
app.post('/api/bookings',async(req,res)=>{const booking=bookingData(req.body);const error=validateBooking(booking);if(error)return res.status(400).json({error});try{const result=db.prepare('INSERT INTO bookings(name,phone,email,service,date,time,message) VALUES(?,?,?,?,?,?,?)').run(booking.name,booking.phone,booking.email,booking.service,booking.date,booking.time,booking.message);const id=result.lastInsertRowid;res.status(201).json({id,notificationStatus:'pending'});const notification=await notifyBooking(booking,id);db.prepare('UPDATE bookings SET notification_status=?,notification_error=? WHERE id=?').run(notification.status,notification.error,id);}catch(err){if(err.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That appointment slot is already booked'});console.error(err);return res.status(500).json({error:'Could not create booking'});}});
app.get('/api/bookings',admin,adminLimiter,(req,res)=>res.json(db.prepare('SELECT * FROM bookings ORDER BY id DESC').all()));
app.patch('/api/bookings/:id',admin,adminLimiter,async(req,res)=>{const allowed=['pending','confirmed','cancelled'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid booking status'});const booking=db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);if(!booking)return res.status(404).json({error:'Booking not found'});const result=db.prepare('UPDATE bookings SET status=? WHERE id=?').run(req.body.status,req.params.id);if(req.body.status==='confirmed'&&booking.status!=='confirmed'){const notification=await notifyCustomerConfirmation({...booking,email:booking.email||''},booking.id);db.prepare('UPDATE bookings SET notification_status=?,notification_error=? WHERE id=?').run(notification.status,notification.error,booking.id);}res.json({ok:true});});
app.delete('/api/bookings/:id',admin,adminLimiter,(req,res)=>{db.prepare('DELETE FROM bookings WHERE id=?').run(req.params.id);res.json({ok:true});});
app.use(express.static(path.join(__dirname,'../frontend')));app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'../admin/index.html')));app.get('/admin',(req,res)=>res.redirect('/dashboard'));app.listen(port,()=>console.log(`Akkis Salon running on port ${port}`));