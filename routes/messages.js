var express = require("express");
var router = express.Router();
let { CheckLogin } = require('../utils/authHandler');
let { uploadImage } = require('../utils/uploadHandler');
let messageModel = require('../schemas/messages');
let mongoose = require('mongoose');

// =====================================================================
// GET /:userID
// Lấy toàn bộ tin nhắn giữa user hiện tại và userID
// (from: me -> to: userID)  UNION  (from: userID -> to: me)
// =====================================================================
router.get('/:userID', CheckLogin, async function (req, res, next) {
    try {
        let me = req.user._id;
        let { userID } = req.params;

        // Kiểm tra userID hợp lệ
        if (!mongoose.Types.ObjectId.isValid(userID)) {
            return res.status(400).send({ message: "userID không hợp lệ" });
        }

        let messages = await messageModel.find({
            $or: [
                { from: me, to: userID },
                { from: userID, to: me }
            ]
        })
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl')
            .sort({ createdAt: 1 }); // Sắp xếp theo thời gian tăng dần

        res.send(messages);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

// =====================================================================
// POST /
// Gửi tin nhắn đến một user (to: userID)
// Body (multipart/form-data hoặc JSON):
//   - to: ObjectId của người nhận
//   - Nếu có file đính kèm: field "file" -> type="file", text=path
//   - Nếu không có file: field "text" -> type="text", text=nội dung
// =====================================================================
router.post('/', CheckLogin, uploadImage.single('file'), async function (req, res, next) {
    try {
        let me = req.user._id;
        let { to, text } = req.body;

        // Kiểm tra to hợp lệ
        if (!to || !mongoose.Types.ObjectId.isValid(to)) {
            return res.status(400).send({ message: "Trường 'to' (userID người nhận) không hợp lệ" });
        }

        // Không được tự nhắn cho chính mình
        if (me.toString() === to.toString()) {
            return res.status(400).send({ message: "Không thể tự gửi tin nhắn cho chính mình" });
        }

        let messageContent;

        if (req.file) {
            // Có file đính kèm -> type = "file", text = đường dẫn file
            messageContent = {
                type: "file",
                text: req.file.path
            };
        } else {
            // Không có file -> type = "text"
            if (!text || text.trim() === '') {
                return res.status(400).send({ message: "Nội dung tin nhắn (text) không được để trống" });
            }
            messageContent = {
                type: "text",
                text: text.trim()
            };
        }

        let newMessage = new messageModel({
            from: me,
            to: to,
            messageContent: messageContent
        });

        await newMessage.save();
        await newMessage.populate('from', 'username fullName avatarUrl');
        await newMessage.populate('to', 'username fullName avatarUrl');

        res.status(201).send(newMessage);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

// =====================================================================
// GET /
// Lấy tin nhắn cuối cùng của mỗi cuộc trò chuyện mà user hiện tại tham gia
// (user hiện tại là người gửi HOẶC người nhận)
// =====================================================================
router.get('/', CheckLogin, async function (req, res, next) {
    try {
        let me = req.user._id;

        // Dùng aggregation để nhóm theo "cặp" hội thoại và lấy tin nhắn cuối cùng
        let conversations = await messageModel.aggregate([
            {
                // Lọc tất cả tin nhắn liên quan đến user hiện tại
                $match: {
                    $or: [
                        { from: new mongoose.Types.ObjectId(me) },
                        { to: new mongoose.Types.ObjectId(me) }
                    ]
                }
            },
            {
                // Tạo field "partner" = đối phương trong cuộc trò chuyện
                $addFields: {
                    partner: {
                        $cond: {
                            if: { $eq: ["$from", new mongoose.Types.ObjectId(me)] },
                            then: "$to",
                            else: "$from"
                        }
                    }
                }
            },
            {
                // Sắp xếp theo thời gian mới nhất để $last lấy đúng
                $sort: { createdAt: 1 }
            },
            {
                // Nhóm theo partner, lấy tin nhắn cuối cùng
                $group: {
                    _id: "$partner",
                    lastMessage: { $last: "$$ROOT" }
                }
            },
            {
                // Sắp xếp cuộc trò chuyện theo tin nhắn mới nhất
                $sort: { "lastMessage.createdAt": -1 }
            }
        ]);

        // Populate thông tin user (from, to) cho mỗi lastMessage
        let result = await messageModel.populate(
            conversations.map(c => c.lastMessage),
            [
                { path: 'from', select: 'username fullName avatarUrl' },
                { path: 'to', select: 'username fullName avatarUrl' }
            ]
        );

        res.send(result);
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

module.exports = router;
