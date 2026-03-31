const nodemailer = require("nodemailer");


const transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: 587,
    secure: false, // Use true for port 465, false for port 587
    auth: {
        user: "6a8fe0e920d1fc",
        pass: "5b708c9f0f534c",
    },
});

module.exports = {
    sendMail: async (to, url) => {
        const info = await transporter.sendMail({
            from: 'Admin@hahah.com',
            to: to,
            subject: "request resetpassword email",
            text: "click vao day de reset", // Plain-text version of the message
            html: "click vao <a href=" + url + ">day</a> de reset", // HTML version of the message
        });

        console.log("Message sent:", info.messageId);
    },
    sendPasswordMail: async (to, username, password) => {
        const info = await transporter.sendMail({
            from: 'Admin@hahah.com',
            to: to,
            subject: "Your New Account Password",
            text: `Hello ${username},\n\nYour account has been created. Your password is: ${password}\n\nPlease keep it safe!`,
            html: `<p>Hello <b>${username}</b>,</p><p>Your account has been created.</p><p>Your password is: <b>${password}</b></p><p>Please keep it safe!</p>`,
        });

        console.log("Password email sent to %s, Message ID: %s", to, info.messageId);
    }
}