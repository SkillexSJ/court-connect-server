const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const admin = require("./firebase"); // Firebase Admin

const app = express();
const port = process.env.PORT || 3000;

const uri = process.env.MONGO_URI;

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = require("stripe")(stripeKey);
// --------------------------
// Middleware
// --------------------------
app.use(
  cors({
    origin: "https://court-connect-cc.netlify.app",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// --------------------------
// Mongo Client
// --------------------------
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// --------------------------
// Firebase Token Verification
// --------------------------
const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1] || req.cookies.token;
  if (!token) return res.status(401).send({ error: "Unauthorized" });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(403).send({ error: "Invalid token" });
  }
};

// --------------------------
// Admin Verify
// --------------------------
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded?.email; // Use decoded email from Firebase token
    if (!email) {
      return res.status(401).send({ error: "Unauthorized: No email found" });
    }

    const user = await usersCollection.findOne({ email });
    if (!user || user.role !== "admin") {
      return res.status(403).send({ error: "Forbidden: Admins only" });
    }

    next(); // user is admin, allow access
  } catch (error) {
    console.error("Error in verifyAdmin:", error);
    res.status(500).send({ error: "Internal server error" });
  }
};

// --------------------------
// Collection
// --------------------------

let courtsCollection;
let bookingsCollection;
let usersCollection;
let couponsCollection;
let announcementsCollection;
let paymentsCollection;

// --------------------------
// MongoDB Connection
// --------------------------
async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("SportDB");
    courtsCollection = db.collection("courts");
    bookingsCollection = db.collection("bookings");
    usersCollection = db.collection("users");
    couponsCollection = db.collection("coupons");
    announcementsCollection = db.collection("announcements");
    paymentsCollection = db.collection("payments");
  } catch (err) {
    console.error("MongoDB connection failed:", err);
  }

  // --------------------------
  // API Routes
  // --------------------------
  app.get("/", (req, res) => {
    res.send("Server is running with MongoDB connected");
  });

  // --------------------------
  // COURTS CRUD
  // --------------------------

  // GET all courts
  app.get("/courts", async (req, res) => {
    try {
      const courts = await courtsCollection.find().toArray();
      res.send(courts);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch courts" });
    }
  });

  // POST new court
  app.post("/courts", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    try {
      const newCourt = req.body;
      if (
        !newCourt.type ||
        !newCourt.image ||
        !newCourt.price ||
        !newCourt.slotTimes
      ) {
        return res.status(400).send({ error: "All fields are required" });
      }

      const result = await courtsCollection.insertOne(newCourt);
      res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
      res.status(500).send({ error: "Failed to add court" });
    }
  });

  // DELETE court by ID
  app.delete(
    "/courts/:id",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const result = await courtsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Court not found" });
        }
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to delete court" });
      }
    }
  );

  // UPDATE court by ID
  app.put("/courts/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updatedCourt = req.body;
      delete updatedCourt._id;

      const result = await courtsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedCourt }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "Court not found" });
      }
      res.send({ success: true });
    } catch (error) {
      res.status(500).send({ error: "Failed to update court" });
    }
  });

  // --------------------------
  // BOOKING SECTION
  // --------------------------

  // Create a new booking (User)
  app.post("/bookings", async (req, res) => {
    try {
      const { courtId, courtName, userEmail, date, slots, totalPrice, status } =
        req.body;

      if (
        !userEmail ||
        !courtId ||
        !date ||
        !status ||
        !courtName ||
        !Array.isArray(slots) ||
        slots.length === 0 ||
        !totalPrice
      ) {
        return res
          .status(400)
          .send({ error: "All booking fields are required" });
      }

      // Fetch court info for display purposes
      const court = await courtsCollection.findOne({
        _id: new ObjectId(courtId),
      });
      if (!court) {
        return res.status(404).send({ error: "Court not found" });
      }

      const booking = {
        userEmail,
        courtId,
        courtName,
        slots,
        totalPrice,
        status: "pending",
        createdAt: new Date(),
        date,
      };

      const result = await bookingsCollection.insertOne(booking);
      res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).send({ error: "Failed to create booking" });
    }
  });

  // Get all bookings (Admin)
  app.get("/bookings", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    try {
      const { status, search = "" } = req.query;

      // Build query object dynamically
      const query = {};

      if (status) {
        query.status = status;
      }

      if (search) {
        query.courtName = { $regex: search, $options: "i" }; // case-insensitive search
      }

      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch bookings" });
    }
  });

  // Approve or reject a booking (Admin)
  app.patch("/bookings/:id", verifyFirebaseToken, async (req, res) => {
    try {
      const bookingId = req.params.id;
      if (!ObjectId.isValid(bookingId)) {
        return res.status(400).send({ message: "Invalid booking ID" });
      }

      const { status } = req.body;

      if (!["approved", "rejected", "confirmed", "paid"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
      });

      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }

      await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        { $set: { status } }
      );

      // Upgrade user to member when booking is approved
      if (status === "approved") {
        const user = await usersCollection.findOne({
          email: booking.userEmail,
        });
        if (user) {
          await usersCollection.updateOne(
            { email: booking.userEmail },
            { $set: { role: "member", memberSince: new Date() } }
          );
        }
      }

      res.send({ message: `Booking ${status} successfully.` });
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).send({ message: "Failed to update booking" });
    }
  });

  // Get approved bookings for a user
  app.get(
    "/bookings/approved/:email",
    verifyFirebaseToken,
    async (req, res) => {
      try {
        const userEmail = req.params.email;
        const approvedBookings = await bookingsCollection
          .find({ userEmail, status: "approved" })
          .toArray();

        res.send(approvedBookings);
      } catch (error) {
        console.error("Error fetching approved bookings:", error);
        res.status(500).send({ error: "Failed to fetch approved bookings" });
      }
    }
  );

  // get paid bookings
  app.get("/bookings/paid/:email", verifyFirebaseToken, async (req, res) => {
    try {
      const userEmail = req.params.email;
      const paidBookings = await bookingsCollection
        .find({ userEmail, status: "paid" })
        .toArray();

      res.send(paidBookings);
    } catch (error) {
      console.error("Error fetching paid bookings:", error);
      res.status(500).send({ error: "Failed to fetch paid bookings" });
    }
  });

  // Get pending bookings for a user
  app.get("/bookings/pending/:email", verifyFirebaseToken, async (req, res) => {
    try {
      const userEmail = req.params.email;
      const bookings = await bookingsCollection
        .find({ userEmail, status: "pending" })
        .toArray();
      res.send(bookings);
    } catch (error) {
      console.error("Error fetching pending bookings:", error);
      res.status(500).send({ error: "Failed to fetch pending bookings" });
    }
  });

  app.get("/bookings/:id", verifyFirebaseToken, async (req, res) => {
    try {
      const bookingId = req.params.id;

      if (!ObjectId.isValid(bookingId)) {
        return res.status(400).send({ error: "Invalid booking ID" });
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
      });

      if (!booking) {
        return res.status(404).send({ error: "Booking not found" });
      }

      res.send(booking);
    } catch (error) {
      console.error("Error fetching booking by ID:", error);
      res.status(500).send({ error: "Failed to fetch booking" });
    }
  });

  // Delete a booking
  app.delete("/bookings/:id", verifyFirebaseToken, async (req, res) => {
    try {
      const bookingId = req.params.id;

      if (!ObjectId.isValid(bookingId)) {
        return res.status(400).send({ error: "Invalid booking ID" });
      }

      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(bookingId),
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ error: "Booking not found" });
      }

      res.send({ success: true });
    } catch (error) {
      console.error("Error deleting booking:", error);
      res.status(500).send({ error: "Failed to delete booking" });
    }
  });

  // --------------------------
  // USER Role Related
  // --------------------------

  app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
    try {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({ role: user.role || "user" });
    } catch (error) {
      console.error("Error getting user role:", error);
      res.status(500).send({ message: "Failed to get role" });
    }
  });

  // GET All Users
  app.get("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    try {
      const users = await usersCollection.find().toArray();
      res.send(users);
    } catch (error) {
      res.status(500).send({ message: "Failed to fetch users" });
    }
  });

  app.post("/users", async (req, res) => {
    const email = req.body.email;
    const userExists = await usersCollection.findOne({ email });
    if (userExists) {
      // update last log in
      return res
        .status(200)
        .send({ message: "User already exists", inserted: false });
    }
    const user = req.body;
    const result = await usersCollection.insertOne(user);
    res.send(result);
  });

  app.patch(
    "/users/:id/role",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!["admin", "user", "member"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ message: `User role updated to ${role}`, result });
      } catch (error) {
        console.error("Error updating user role", error);
        res.status(500).send({ message: "Failed to update user role" });
      }
    }
  );

  app.get(
    "/users/members",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const members = await usersCollection
          .find({ role: "member" })
          .toArray();
        res.send(members);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch members" });
      }
    }
  );

  // app.get(
  //   "/users/:email",
  //   verifyFirebaseToken,
  //   verifyAdmin,
  //   async (req, res) => {
  //     const { email } = req.params;
  //     try {
  //       const user = await usersCollection.findOne({ email });
  //       if (!user) {
  //         return res.status(404).send({ message: "User not found" });
  //       }
  //       res.send(user);
  //     } catch (error) {
  //       console.error("Error fetching user:", error);
  //       res.status(500).send({ message: "Failed to fetch user" });
  //     }
  //   }
  // );
  // GET a single user by email
 app.get("/users/:email", verifyFirebaseToken, async (req, res) => {
  try {
    const requestedEmail = req.params.email;
    const requesterEmail = req.decoded.email;

    // Fetch requester user info to check role
    const requesterUser = await usersCollection.findOne({ email: requesterEmail });

    if (!requesterUser) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    // Allow if requester is admin OR requester is asking their own data
    if (requesterUser.role !== "admin" && requesterEmail !== requestedEmail) {
      return res.status(403).send({ message: "Forbidden: Access denied" });
    }

    const user = await usersCollection.findOne({ email: requestedEmail });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).send({ message: "Failed to fetch user" });
  }
});

  // --------------------------
  // COUPONS CRUD
  // --------------------------

  // GET all coupons
  app.get("/coupons", async (req, res) => {
    try {
      const coupons = await couponsCollection.find().toArray();
      res.send(coupons);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch coupons" });
    }
  });

  // POST a new coupon
  app.post("/coupons", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    try {
      const { code, discount, expiry } = req.body;

      if (!code || !discount || !expiry) {
        return res.status(400).send({ error: "All fields are required" });
      }

      const newCoupon = { code, discount, expiry };
      const result = await couponsCollection.insertOne(newCoupon);
      res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
      res.status(500).send({ error: "Failed to add coupon" });
    }
  });

  // DELETE a coupon
  app.delete(
    "/coupons/:id",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const result = await couponsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Coupon not found" });
        }
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to delete coupon" });
      }
    }
  );

  // UPDATE a coupon
  app.put(
    "/coupons/:id",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const updatedCoupon = req.body;

        const result = await couponsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedCoupon }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Coupon not found" });
        }
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to update coupon" });
      }
    }
  );

  // GET coupon by code
  app.get("/coupons/:code", verifyFirebaseToken, async (req, res) => {
    try {
      const { code } = req.params;
      const coupon = await couponsCollection.findOne({ code: code.trim() });

      if (!coupon) {
        return res
          .status(404)
          .send({ isValid: false, error: "Coupon not found" });
      }

      // Check expiry date
      const currentDate = new Date();
      const expiryDate = new Date(coupon.expiry);
      if (currentDate > expiryDate) {
        return res
          .status(400)
          .send({ isValid: false, error: "Coupon has expired" });
      }

      // Coupon is valid
      res.send({
        isValid: true,
        discount: coupon.discount, // Discount in USD
        code: coupon.code,
        expiry: coupon.expiry,
      });
    } catch (error) {
      res.status(500).send({ isValid: false, error: "Failed to fetch coupon" });
    }
  });

  // -------------------------
  // Announcements CRUD
  // -------------------------

  // Get all announcements
  app.get("/announcements", async (req, res) => {
    try {
      const announcements = await announcementsCollection.find().toArray();
      res.send(announcements);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch announcements" });
    }
  });

  // Add announcement
  app.post(
    "/announcements",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const newAnnouncement = req.body;
        if (!newAnnouncement.title || !newAnnouncement.message) {
          return res
            .status(400)
            .send({ error: "Title and message are required" });
        }

        const result = await announcementsCollection.insertOne(newAnnouncement);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ error: "Failed to add announcement" });
      }
    }
  );

  // Update announcement
  app.put(
    "/announcements/:id",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const updatedAnnouncement = req.body;
        const result = await announcementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedAnnouncement }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Announcement not found" });
        }
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to update announcement" });
      }
    }
  );

  // Delete announcement
  app.delete(
    "/announcements/:id",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const result = await announcementsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Announcement not found" });
        }
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to delete announcement" });
      }
    }
  );

  // -------------------------
  // Payment CRUD
  // -------------------------

  // get payment data
  app.get("/payments", verifyFirebaseToken, async (req, res) => {
    try {
      const userEmail = req.query.email;
      if (req.decoded.email !== userEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = userEmail ? { email: userEmail } : {};
      const options = { sort: { paid_at: -1 } }; // Latest first

      const payments = await paymentsCollection.find(query, options).toArray();
      res.send(payments);
    } catch (error) {
      console.error("Error fetching payment history:", error);
      res.status(500).send({ message: "Failed to get payments" });
    }
  });

  // post payment data
  app.post("/payments", verifyFirebaseToken, async (req, res) => {
    try {
      const {
        bookingId,
        email,
        amount,
        paymentMethod,
        transactionId,
        discount,
        coupon,
      } = req.body;

      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return res.status(400).send({ error: "Invalid or missing booking ID" });
      }

      const payment = {
        bookingId,
        email,
        amount,
        paymentMethod,
        transactionId,
        discount: discount || 0,
        coupon: coupon || null,
        createdAt: new Date(),
      };

      await paymentsCollection.insertOne(payment);

      const updateResult = await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        { $set: { status: "paid" } }
      );

      if (updateResult.matchedCount === 0) {
        return res
          .status(404)
          .send({ error: "Booking not found or status not updated" });
      }

      res.send({
        success: true,
        message: "Payment recorded and booking confirmed",
      });
    } catch (error) {
      console.error("Error processing payment:", error);
      res.status(500).send({ error: "Failed to process payment" });
    }
  });

  // payment intent
  app.post("/create-payment-intent", verifyFirebaseToken, async (req, res) => {
    try {
      const { amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send(paymentIntent.client_secret);
    } catch (error) {
      console.error("Error creating payment intent:", error);
      res.status(500).send({ error: "Failed to create payment intent" });
    }
  });

  /// profile section
  app.get(
    "/admin/profile/:email",
    verifyFirebaseToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const adminEmail = req.params.email;

        // Find the admin user
        const adminUser = await usersCollection.findOne({ email: adminEmail });

        if (!adminUser) {
          return res.status(404).send({ error: "Admin not found" });
        }

        // Fetch statistics
        const [totalCourts, totalUsers, totalMembers] = await Promise.all([
          courtsCollection.countDocuments(),
          usersCollection.countDocuments(),
          usersCollection.countDocuments({ role: "member" }),
        ]);

        res.send({
          name: adminUser.name || "Admin",
          email: adminUser.email,
          image: adminUser.image || "/default-admin.png",
          totalCourts,
          totalUsers,
          totalMembers,
        });
      } catch (error) {
        console.error("Error fetching admin profile:", error);
        res.status(500).send({ error: "Failed to fetch admin profile" });
      }
    }
  );

  // Get member profile by email
  app.get("/member/profile/:email", verifyFirebaseToken, async (req, res) => {
    try {
      const memberEmail = req.params.email;

      const member = await usersCollection.findOne({ email: memberEmail });
      if (!member) {
        return res.status(404).send({ error: "User not found" });
      }

      res.send({
        name: member.name || "Member",
        email: member.email,
        image: member.image || "/default-user.png",
        role: member.role || "user",
        memberSince: member.memberSince || null,
      });
    } catch (error) {
      console.error("Error fetching member profile:", error);
      res.status(500).send({ error: "Failed to fetch member profile" });
    }
  });

  // --------------------------
  // Start Server
  // --------------------------
  // app.listen(port, () => {
  //   console.log(`🚀 Server running at http://localhost:${port}`);
  // });
}

connectDB();
