import { WebSocketServer } from "ws";
import mysql from 'mysql2/promise';



async function getOrCreatePrivateChat(db, userA, userB) {
   
    const [rows] = await db.execute(
        `SELECT c.id
         FROM chats c
         JOIN chat_members cm1 ON cm1.chat_id = c.id
         JOIN chat_members cm2 ON cm2.chat_id = c.id
         WHERE c.is_private = 1
           AND cm1.user_id = ?
           AND cm2.user_id = ?
         LIMIT 1;`,
        [userA, userB]
    );

    if (rows.length > 0) {
       
        return rows[0].id;
    }

  
    const [insertChat] = await db.execute(
        "INSERT INTO chats (is_private) VALUES (1)"
    );

    const chatId = insertChat.insertId;

    
    await db.execute(
        "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)",
        [chatId, userA, chatId, userB]
    );

    return chatId;
}

async function sendMessage(db, chatId, senderId, content) {
  await db.execute(
    `INSERT INTO messages (chat_id, sender_id, content) VALUES (?, ?, ?)`, [chatId, senderId, content]
  );
}



async function start() {
    const wss = new WebSocketServer({ port: 8080 });
    const onlineUsers = new Map(); 
    
    const db = await mysql.createConnection({
        host: '127.0.0.1',
        user: 'root',
        password: '12345678',
        database: 'chat_app',
    });
    console.log('Подключение к базе успешно');

    
    
    wss.on("connection", (ws, req) => {
         ws.on("close", () => {
              if (ws.userId) {
                onlineUsers.delete(ws.userId);
                console.log("Пользователь отключился:", ws.userId);
              }
        });
    
      const ip = req.socket.remoteAddress;
      console.log("Клиент подключился ip:", ip);
    
      ws.on("message", async(msg) => {
        console.log(msg);
        try {
          const data = JSON.parse(msg);
          console.log("message:", data);
    
          if (data.type === "add_user") {

              const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [data.name])

              if(rows.length > 0){
                console.log("Username is already used");
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Username already taken"
                }));
                return;
              }
            
            await db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', [data.name, data.password]);
             ws.send(JSON.stringify({
               type: "add_success",
               user: { name: data.name }
             }));
            console.log("User was added");

            //Вход
          }else if (data.type === "login"){
            console.log("проверка...")
            const [rows] = await db.execute('SELECT * FROM users WHERE username = ? AND password_hash = ?', [data.name, data.password])
            console.log("проверка выполнена");

            if(rows.length === 0){
                console.log("Неверный логин или пароль");
               ws.send(JSON.stringify({
                 type: "login_error",
                 message: "Wrong username or password"
               }));
               return;
            }

            const userId = rows[0].id;

            const [friendRows] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND friends.status = 'accepted'`,
                [userId]
            );
            const [RequestfriendRows] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND (friends.status <> 'accepted' OR friends.status IS NULL)`,
                [userId]
            );

            console.log("Пользователь успешно вошёл", rows[0]);
            ws.userId = userId;
            onlineUsers.set(userId, ws);

            ws.send(JSON.stringify({
              type: "login_success",
              user:  rows[0].username,
              id: userId,
              friends: friendRows,
              Requestfriends: RequestfriendRows
            }));

          }else if(data.type === "accept_friend"){

            await db.execute(
                "UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?",
                [data.friend_id, data.my_id]
            );
            
            await db.execute(
                "UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?",
                [data.my_id, data.friend_id]
            );
            const [friendRows] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND friends.status = 'accepted'`,
                [data.my_id]
            );
        
            const [requestRows] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? 
                 AND friends.status = 'pending'`,
                [data.my_id]
            );
            ws.send(JSON.stringify({
                type: "add_friend",
                friends: friendRows,
                Requestfriends: requestRows
            }))
            if(onlineUsers.has(data.friend_id)){
              const [friendRowsF] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND friends.status = 'accepted'`,
                [data.friend_id]
            );
             const [requestRowsF] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? 
                 AND friends.status = 'pending'`,
                [data.friend_id]
            );
              onlineUsers.get(data.friend_id).send(JSON.stringify({
                type: "add_friend",
                friends: friendRowsF,
                Requestfriends: requestRowsF
              }))
            }

            console.log("статус изменен");


          } else if (data.type === "find_friend"){

            if (!data.user || !data.friend) {
              ws.send(JSON.stringify({
                type: "error",
                message: "User and friend fields are required"
              }));
              return;
            }
            console.log("search...")
            
            const [userRows] = await db.execute('SELECT id FROM users WHERE username = ?', [data.user]);
            if (userRows.length === 0) throw new Error("Пользователь не найден");
            console.log("Пользователь найден");

            const userId = userRows[0].id;

            const [friendRows] = await db.execute('SELECT id FROM users WHERE username = ?', [data.friend]);
            if (friendRows.length === 0) throw new Error("Друг не найден");
            console.log("друг найден");

            const friendId = friendRows[0].id;

            const [exists] = await db.execute('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?', [userId, friendId]);

            if (exists.length > 0){
              console.log("они уже дружат");

              ws.send(JSON.stringify({
                type: "error",
                message: "you are already friends"
              }))
              return;
            }
           
            await db.execute('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [userId, friendId, "pending"]);
            await db.execute('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [friendId, userId, "pending"]);


            console.log("добавлен");

            const [friendsRow] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND friends.status = 'accepted'`,
                [userId]
            );
            const [RequestfriendRows] = await db.execute(
                `SELECT users.id, users.username AS name
                 FROM friends
                 JOIN users ON users.id = friends.friend_id
                 WHERE friends.user_id = ? AND friends.status ='pending'`,
                [userId]
            );

            console.log("отправка...");
            ws.send(JSON.stringify({
              type: "add_friend",
              friends: friendsRow,
              Requestfriends: RequestfriendRows
            }));
            console.log("готово!")

            if(onlineUsers.has(friendId)){
              const [incomingRequests] = await db.execute(`
                SELECT users.id, users.username AS name
                FROM friends
                JOIN users ON users.id = friends.friend_id
                WHERE friends.user_id = ? AND friends.status = 'pending'
             `, [friendId]);

              onlineUsers.get(friendId).send(JSON.stringify({
                type: "add_friend",
                friends: [],
                Requestfriends: incomingRequests
              }));
            }else{
              console.log("не онлайн")
            }

          }else if (data.type === "get_messages") {
          
              const chatId = await getOrCreatePrivateChat(db, data.from, data.to);
          
             const [messages] = await db.execute(
                `SELECT 
                    sender_id AS sender, 
                    content AS text, 
                    sent_at AS date
                 FROM messages
                 WHERE chat_id = ?
                 ORDER BY id ASC`,
                [chatId]
            );


          
              ws.send(JSON.stringify({
                  type: "messages_history",
                  messages: messages
              }));

          }else if (data.type === "send_messages") {
            
            const [receiverRows] = await db.execute(
                'SELECT * FROM users WHERE id = ?',
                [data.to]
            );
        
            if (receiverRows.length === 0) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Receiver wasn't found"
                }));
                return;
            }
        
            const [friendRows] = await db.execute(
              `SELECT 1
               FROM friends
               WHERE ((user_id = ? AND friend_id = ?)
                      OR (user_id = ? AND friend_id = ?))
                 AND status = 'accepted'
               LIMIT 1;`,
              [data.from, data.to, data.to, data.from]
            );
        
            if (friendRows.length === 0) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "You are not friends!"
                }));
                return;
            }
        
            
            const chatId = await getOrCreatePrivateChat(db, data.from, data.to);
        
            console.log("Chat ID:", chatId);
        
           
            await sendMessage(db, chatId, data.from, data.message);
        
        
          
            if (onlineUsers.has(data.to)) {
                onlineUsers.get(data.to).send(JSON.stringify({
                    type: "new_message",
                    from: data.from,
                    text: data.message,
                    date: data.date
                }));
            }
            
                console.log("сообщение отправлено");
          }
 
    
        } catch (err) {
          console.error("Ошибка JSON:", err);
        }
      });
    });
        
    console.log("Сервер запущен на ws://localhost:8080");
}

start();