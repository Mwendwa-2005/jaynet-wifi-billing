# ⚡ JayNet Wi-Fi Billing & Router Management System

JayNet is a real-time Wi-Fi billing system designed for MikroTik Hotspots and Safaricom M-Pesa Daraja STK Push integration. It features an **Apple-style Liquid Floating** mesh interface, glassmorphism UI, real-time WebSocket payment notifications, automated user activation, and a full-featured admin management panel.

---

## 📁 Project File Structure in VS Code

```
jaynet-wifi-billing/
├── package.json               # Project dependencies and start script
├── .env                       # Active environment settings
├── .env.example               # Template environment file
├── server.js                  # Main Express backend server & REST API
├── db.js                      # SQLite Database controller & schema
├── services/
│   ├── mpesa.js               # Safaricom Daraja API STK Push service
│   └── mikrotik.js            # MikroTik RouterOS API controller & simulator
├── public/
│   ├── index.html             # Client Captive Portal with Apple Liquid floating effect
│   ├── admin.html             # Full Admin Management & Customer Support Dashboard
│   ├── login.html             # MikroTik Hotspot router captive portal template
│   ├── css/
│   │   └── liquid.css         # Apple design system, glassmorphism, animations
│   └── js/
│       ├── liquid-canvas.js   # Dynamic interactive Apple liquid canvas animation
│       ├── app.js             # Client portal logic & STK push handler
│       └── admin.js           # Admin dashboard interactive logic
└── README.md                  # Setup & execution guidelines
```

---

## 🚀 Step-by-Step Setup & How to Run in VS Code

### Step 1: Open Project Folder in VS Code
1. Launch **Visual Studio Code**.
2. Click **File -> Open Folder...**
3. Navigate to: `C:\Users\Willfred Jayem\.gemini\antigravity\scratch\jaynet-wifi-billing`
4. Click **Select Folder**.

### Step 2: Open VS Code Integrated Terminal
Press `` Ctrl + ` `` (or select **Terminal -> New Terminal** from the top menu).

### Step 3: Install Dependencies
Run the following command in the terminal:
```bash
npm install
```

### Step 4: Start the Server
Run the application server:
```bash
npm start
```

You will see the startup confirmation:
```
============================================================
⚡ JayNet Wi-Fi Billing System Server Online!
------------------------------------------------------------
🌐 Captive Portal Homepage : http://localhost:3000
⚙️ Admin Management Panel : http://localhost:3000/admin.html
============================================================
```

---

## 🌐 Navigating the System

1. **Client Captive Portal (Homepage)**:
   - Open [http://localhost:3000](http://localhost:3000) in your browser.
   - Features the **Apple Liquid Floating Canvas** background.
   - Click on any Wi-Fi package (e.g. 10 KES / 3 Hours).
   - Enter your phone number (e.g., `0712345678`).
   - Click **Pay with M-Pesa**.
   - In **Simulation Mode**, the system auto-approves payment after 4 seconds and connects the user with hotspot credentials!

2. **Admin Control Panel**:
   - Open [http://localhost:3000/admin.html](http://localhost:3000/admin.html) in your browser.
   - **Metrics Overview**: Live M-Pesa revenue, active sessions, total transactions, and router connectivity status.
   - **Wi-Fi Packages Tab**: Create, edit, set prices (e.g. KES 10), duration, speed limits, and maximum devices.
   - **Live Transactions Tab**: Real-time log of M-Pesa payments with receipt numbers and checkout request IDs.
   - **Active Sessions Tab**: View connected clients, extend session times (+1 Hr), or kick/disconnect users.
   - **Customer Support Tab**: View client connection tickets and resolve issues.
   - **Settings & Integrations Tab**: Configure Safaricom Daraja credentials and MikroTik Router IP/credentials with a live connection test button!

---

## 📡 Live Hardware Setup Guidelines

### 1. Connecting Safaricom M-Pesa Daraja API for Live Payments
- Go to [Safaricom Developer Portal](https://developer.safaricom.co.ke).
- Create an app to obtain your **Consumer Key**, **Consumer Secret**, **Passkey**, and **Shortcode/Till Number**.
- Open the **Admin Panel -> Settings & Integrations** tab at `http://localhost:3000/admin.html`.
- Enter your Daraja keys and your public webhook callback URL (e.g. via `ngrok http 3000`).
- Toggle environment to **Production** or **Sandbox** and click **Save All Settings**.

### 2. Connecting MikroTik RouterOS API
- Ensure your MikroTik router API service is enabled:
  ```routeros
  /ip service enable api
  ```
- In the Admin Panel Settings tab, enter your MikroTik IP (e.g., `192.168.88.1`), Username (`admin`), and Password.
- Switch Router Mode from `Simulation` to `Live MikroTik Hardware`.
- Click **Test Router Connection** to verify API communication.

### 3. MikroTik Hotspot Redirect Page
- Copy `public/login.html` to your MikroTik router's hotspot directory using WinBox (`Files` tab) or FTP to `flash/hotspot/login.html`.
- When clients connect to the Wi-Fi Access Point, they will be automatically redirected to your JayNet Billing Server homepage!
