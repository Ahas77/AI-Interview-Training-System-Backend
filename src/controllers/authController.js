const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

const authController = {
  async register(req, res) {
    try {
      const {
        first_name,
        last_name,
        email,
        mobile_contact_number,
        address,
        nic,
        dateOfBirth,
        gender,
        password,
        password_confirmation,
      } = req.body;

      // Validation
      const errors = {};

      if (!first_name || !first_name.trim()) {
        errors.first_name = ["First name is required."];
      }
      if (!last_name || !last_name.trim()) {
        errors.last_name = ["Last name is required."];
      }
      if (!email || !email.trim()) {
        errors.email = ["Email address is required."];
      }
      if (!mobile_contact_number || !mobile_contact_number.trim()) {
        errors.mobile_contact_number = ["Mobile contact number is required."];
      }
      if (!nic || !nic.trim()) {
        errors.nic = ["NIC or Passport number is required."];
      }
      if (!password) {
        errors.password = ["Password is required."];
      }
      if (password && password.length < 6) {
        errors.password = ["Password must be at least 6 characters."];
      }
      if (password !== password_confirmation) {
        errors.password_confirmation = ["Passwords do not match."];
      }

      if (Object.keys(errors).length > 0) {
        return res.status(422).json({
          success: false,
          message: "Validation failed.",
          errors,
        });
      }

      // Check duplicates
      const existingEmail = await User.findByEmail(email.trim());
      if (existingEmail) {
        return res.status(422).json({
          success: false,
          message: "Validation failed.",
          errors: { email: ["Email address is already registered."] },
        });
      }

      const existingMobile = await User.findByMobile(mobile_contact_number.trim());
      if (existingMobile) {
        return res.status(422).json({
          success: false,
          message: "Validation failed.",
          errors: { mobile_contact_number: ["Mobile contact number is already registered."] },
        });
      }

      const existingNic = await User.findByNic(nic.trim());
      if (existingNic) {
        return res.status(422).json({
          success: false,
          message: "Validation failed.",
          errors: { nic: ["NIC or Passport number is already registered."] },
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Save user
      const userId = await User.createUser({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.trim().toLowerCase(),
        mobile_contact_number: mobile_contact_number.trim(),
        nic: nic.trim(),
        address: address ? address.trim() : null,
        date_of_birth: dateOfBirth || null,
        gender: gender || "Male",
        password: hashedPassword,
        role: "user",
      });

      return res.status(201).json({
        success: true,
        message: "Account created successfully!",
        data: {
          id: userId,
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: email.trim().toLowerCase(),
        },
      });
    } catch (error) {
      console.error("Register Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error during registration.",
      });
    }
  },

  async login(req, res) {
    try {
      const { type, value, password } = req.body;

      if (!value || !value.trim() || !password) {
        return res.status(400).json({
          success: false,
          message: "Please provide both account identifier and password.",
        });
      }

      const cleanValue = value.trim();
      let user = null;

      if (type === "mobile_contact_number") {
        user = await User.findByMobile(cleanValue);
      } else {
        user = await User.findByEmail(cleanValue.toLowerCase());
      }

      // Fallback search if not found
      if (!user) {
        user = (await User.findByEmail(cleanValue.toLowerCase())) || (await User.findByMobile(cleanValue));
      }

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials. User not found.",
        });
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials. Incorrect password.",
        });
      }

      // Generate JWT Token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || "default_secret_key",
        { expiresIn: "7d" }
      );

      const fullName = `${user.first_name} ${user.last_name}`.trim();

      return res.status(200).json({
        success: true,
        message: "Signed in successfully!",
        token,
        data: {
          user_id: user.id,
          name: fullName,
          email: user.email,
          role: user.role || "user",
          avatar: user.avatar || "",
        },
      });
    } catch (error) {
      console.error("Login Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error during login.",
      });
    }
  },

  async getProfile(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          username: user.email ? user.email.split("@")[0] : `user_${user.id}`,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          mobile_contact_number: user.mobile_contact_number,
          dateOfBirth: user.date_of_birth,
          gender: user.gender || "Male",
          status: "approved",
          avatar: user.avatar,
          qr_code: null,
        },
      });
    } catch (error) {
      console.error("GetProfile Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }
  },

  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { first_name, last_name, mobile_contact_number, dateOfBirth, gender } = req.body;

      const { pool } = require("../config/db");
      await pool.query(
        "UPDATE users SET first_name = ?, last_name = ?, mobile_contact_number = ?, date_of_birth = ? WHERE id = ?",
        [first_name, last_name, mobile_contact_number, dateOfBirth || null, userId]
      );

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully.",
      });
    } catch (error) {
      console.error("UpdateProfile Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile.",
      });
    }
  },

  async profileResetPassword(req, res) {
    try {
      const userId = req.user.id;
      const { new_password, confirm_password } = req.body;

      if (!new_password || new_password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match.",
        });
      }

      const hashedPassword = await bcrypt.hash(new_password, 10);
      const { pool } = require("../config/db");
      await pool.query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, userId]);

      return res.status(200).json({
        success: true,
        message: "Password updated successfully.",
      });
    } catch (error) {
      console.error("ResetPassword Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update password.",
      });
    }
  },

  async logout(req, res) {
    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  },
};

module.exports = authController;
