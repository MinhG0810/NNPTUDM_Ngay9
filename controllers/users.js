let userModel = require("../schemas/users");
let roleModel = require("../schemas/roles");
let bcrypt = require('bcrypt');
let exceljs = require('exceljs');
let crypto = require('crypto');
let mailHandler = require('../utils/mailHandler');

// Global flag to prevent concurrent overlapping imports
let isImporting = false;

module.exports = {
    CreateAnUser: async function (username, password, email, role, session,
        fullName, avatarUrl, status, loginCount
    ) {
        let newUser = new userModel({
            username: username,
            password: password,
            email: email,
            fullName: fullName,
            avatarUrl: avatarUrl,
            status: status,
            role: role,
            loginCount: loginCount
        })
        await newUser.save({ session });
        return newUser;
    },
    FindUserByUsername: async function (username) {
        return await userModel.findOne({
            isDeleted: false,
            username: username
        })
    }, FindUserByEmail: async function (email) {
        return await userModel.findOne({
            isDeleted: false,
            email: email
        })
    },
    FindUserByToken: async function (token) {
        let result = await userModel.findOne({
            isDeleted: false,
            forgotPasswordToken: token
        })
        if (result.forgotPasswordTokenExp > Date.now()) {
            return result;
        }
        return false
    },
    CompareLogin: async function (user, password) {
        if (bcrypt.compareSync(password, user.password)) {
            user.loginCount = 0;
            await user.save()
            return user;
        }
        user.loginCount++;
        if (user.loginCount == 3) {
            user.lockTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
            user.loginCount = 0;
        }
        await user.save()
        return false;
    },
    GetUserById: async function (id) {
        try {
            let user = await userModel.findOne({
                _id: id,
                isDeleted: false
            }).populate('role')
            return user;
        } catch (error) {
            return false;
        }
    },
    ImportUsers: async function (filePath) {
        if (isImporting) {
            throw new Error("Hệ thống đang xử lý một tiến trình import khác. Vui lòng không nhấn Import nhiều lần và đợi trong ít phút để hệ thống gửi xong email.");
        }
        isImporting = true;

        try {
            let workbook = new exceljs.Workbook();
            await workbook.xlsx.readFile(filePath);
            let worksheet = workbook.worksheets[0];

            let userRole = await roleModel.findOne({ name: 'user' });
            if (!userRole) {
                throw new Error("Role 'user' not found in database.");
            }

            // 1. Đọc toàn bộ user từ Excel
            let rawUsers = [];
            for (let i = 2; i <= worksheet.rowCount; i++) {
                let row = worksheet.getRow(i);
                let username = row.getCell(1).value;
                let email = row.getCell(2).value;
                if (username && email) {
                    rawUsers.push({ username: username.toString().trim(), email: email.toString().trim() });
                }
            }

            // 2. Lọc bỏ các user đã tồn tại (Query 1 lần thay vì N lần)
            const usernames = rawUsers.map(u => u.username);
            const existingUsers = await userModel.find({ username: { $in: usernames } }, 'username');
            const existingUsernames = new Set(existingUsers.map(u => u.username));

            const validUsersToInsert = [];
            const emailTasks = []; // Lưu trữ mật khẩu dạng rõ để gửi email sau

            // 3. Hash password thủ công (do insertMany không tự động gọi middleware pre-save)
            for (let u of rawUsers) {
                if (existingUsernames.has(u.username)) continue;

                let plainPassword = crypto.randomBytes(8).toString('hex');
                let salt = bcrypt.genSaltSync(10);
                let hashedPassword = bcrypt.hashSync(plainPassword, salt);

                validUsersToInsert.push({
                    username: u.username,
                    email: u.email,
                    password: hashedPassword,
                    role: userRole._id
                });
                
                emailTasks.push({ username: u.username, email: u.email, plainPassword });
            }

            // 4. Batch InsertMany mỗi 1000 dòng vào DB
            let importedUsernames = [];
            const BATCH_SIZE = 1000;
            for (let i = 0; i < validUsersToInsert.length; i += BATCH_SIZE) {
                const batch = validUsersToInsert.slice(i, i + BATCH_SIZE);
                await userModel.insertMany(batch, { ordered: false });
                importedUsernames.push(...batch.map(u => u.username));
            }

            // 5. Chạy Background Task để gửi mail từ từ (Không block API Reponse)
            // Nhờ đó web / postman sẽ nhận được phản hồi ngay lập tức lúc Insert DB xong!
            if (emailTasks.length > 0) {
                (async () => {
                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                    console.log(`[Background] Đang tiến hành gửi ${emailTasks.length} emails tuần tự...`);
                    for (let task of emailTasks) {
                        let emailSent = false;
                        let retries = 3;
                        while (!emailSent && retries > 0) {
                            try {
                                await mailHandler.sendPasswordMail(task.email, task.username, task.plainPassword);
                                emailSent = true;
                            } catch (mailErr) {
                                console.log(`Failed to send email to ${task.username}, retrying in 5 seconds...`, mailErr.message);
                                retries--;
                                await sleep(5000);
                            }
                        }
                        if (!emailSent) {
                            console.log(`WARNING: Completely failed to send email to ${task.username} sau ${3} lần thử.`);
                        }
                        // Delay Mailtrap Testing Plan limit rảnh rang
                        await sleep(4500);
                    }
                    console.log("[Background] Hoàn tất quá trình gửi toàn bộ emails!");
                })(); // Gọi và không await
            }
            
            return importedUsernames;
        } finally {
            isImporting = false;
        }
    }
}