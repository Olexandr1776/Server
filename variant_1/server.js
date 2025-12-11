import { WebSocketServer } from "ws";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

const wss = new WebSocketServer({ port: 8080 });

let users = [];




function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

function User(id, name, password, ip, friends = [], ws){
  this.name = name;
  this.password = password;
  this.ip = ip;
  this.ws = ws;
  this.friends = friends;
  this.id = id;
}

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log("Клиент подключился ip:", ip);

  ws.on("message", (msg) => {
    console.log(msg);
    try {
      const data = JSON.parse(msg);
      console.log("message:", data);

    
      if (data.type === "add_user") {

        if (users.find(user => user.name === data.name)) {
          ws.send(JSON.stringify({
            type: "user_is_busy"
          }));
          console.log("user name is busy");

        } else {

          let id = getRandomInt(0, 1000);

          users.push(new User(id, data.name, data.password, ip));
          console.log("Пользователь добавлен:", data.name);
          console.log(users);
          ws.send("Пользователь добавлен: " + data.name);
        }


 
      } else if (data.type === "login") {

        const user = users.find(user => user.name === data.name);

        if (user && user.password === data.password) {
          user.ws = ws;
          console.log(ws);

          console.log("пользователь вошел");

          ws.send(JSON.stringify({
            type: "login_success",
            name: user.name,
            friends: user.friends,
            id: user.id
          }));

        } else {
          ws.send(JSON.stringify({
            type: "error",
            message: "пароль или логин неправильны"
          }));
          console.log("пароль или логин неправильны");
        }


   
      } else if (data.type === "find_friend") {

        const user = users.find(u => u.name === data.user);
        if (!user) {
          console.log("Your account was not found");
          return;
        }

        const friend = users.find(f => f.name === data.name);
        if (friend) {
          
          if(user.friends.includes(data.name)){
            ws.send(JSON.stringify({
              type: "It's_already_your_friend"
            }))
            return;
          }else{    
                console.log("friend was found");
                user.friends.push({
                    id: friend.id,
                    name: friend.name
                });

                friend.friends.push({
                    id: user.id,
                    name: user.name
                });

                console.log("друг положен в массив");

                ws.send(JSON.stringify({
                  type: "add_friend",
                  friends: user.friends,
                }))
                friend.ws.send(JSON.stringify({
                   type: "add_friend",
                   friends: friend.friends,
                }))
                for(let i = 0; i < users.length; i++){
                  console.log(users[i]);
                }

          }
        }

      }else if(data.type === "send_messages"){
          const sender = users.find(u => u.id === data.from);
          const receiver = users.find(u => u.id === data.to);

           if (receiver && receiver.ws) {
              receiver.ws.send(JSON.stringify({
                type: "new_message",
                from: sender.id,
                text: data.text,
                date: data.date
              }))
           }
          else {
            console.log(data.name + " was not found");
          }    
      } else {
        ws.send("Неизвестная команда: " + data.type);
      }


    } catch (err) {
      console.error("Ошибка JSON:", err);
    }
  });
});

console.log("Сервер запущен на ws://localhost:8080");

