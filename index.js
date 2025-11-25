const express = require("express");
const { graphqlHTTP } = require("express-graphql");
const { readFileSync } = require("fs");
const {
  assertResolversPresent,
  makeExecutableSchema,
} = require("@graphql-tools/schema");

const { MongoClient } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;

const fs = require("fs");

const { GraphQLError } = require("graphql");

//const DataLoader = require('dataloader');

const app = express();

const typeDefs = readFileSync("./schema.graphql").toString("utf-8");

class mongoDB {
  constructor() {
    const path = "./config/mongo.json";
    //const path = "./config/mongo.txt";
    let res;
    let data;

    try {
      const res = fs.readFileSync(path);
      data = JSON.parse(res);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error("invalid JSON file");
        process.exit(2);
      } else {
        console.error(err);
        process.exit(1);
      }
    }

    //const uri = "mongodb://localhost:270?useUnifiedTopology=true";
    const uri = `mongodb://${data.host}:${data.port}`;

    MongoClient.connect(uri)
      .then((res) => {
        console.log("connected to MongoDB");
      })
      .catch((err) => {
        console.error("Failed to connect to MongoDB:", err);
        process.exit(5);
      });

    const client = new MongoClient(uri);

    const database = client.db(data.db);

    this._db = database;
    this._collection = this._db.collection("player");
    this._collectionMatch = this._db.collection("match");

    console.log("after constructor");
  }

  async getPlayer(id) {
    let selector;

    if (id == undefined) selector = {};
    else {
      selector = {
        _id: new ObjectId(id),
      };
    }

    let data = await this._collection.find(selector).toArray();

    for (let ele of data) {
      ele._id = ele._id.toString();
    }

    return data;
  }

  async clearPlayers() {
    await this._collection.deleteMany({});
  }

  async createPlayer(data) {
    //await this.clearPlayers();

    const { insertedId: mid } = await this._collection.insertOne(data);

    if (!mid) {
      throw new Error(`Error insert player -- data:${data}`);
    }

    return mid.toString();
  }

  async deletePlayer(id) {
    const filter = {
      _id: new ObjectId(id),
    };

    const result = await this._collection.deleteOne(filter);
  }

  async updatePlayer(id, data) {
    const filter = {
      _id: new ObjectId(id),
    };

    let update = {
      $set: {
        is_active: data.is_active,
        lname: data.lname,
        balance_usd_cents: parseInt(data.balance_usd_cents),
      },
    };

    const result = await this._collection.updateOne(filter, update);
  }

  /**
   *
   *      Match
   *
   */

  async getMatch(id) {
    let selector;

    if (id == undefined) selector = {};
    else {
      selector = {
        _id: new ObjectId(id),
      };
    }

    let data = await this._collectionMatch.find(selector).toArray();

    for (let ele of data) {
      ele._id = ele._id.toString();
    }

    return data;
  }

  async clearMatch() {
    await this._collectionMatch.deleteMany({});
  }

  async createMatch(data) {
    //await this.clearPlayers();

    const { insertedId: mid } = await this._collectionMatch.insertOne(data);

    if (!mid) {
      throw new Error(`Error insert Match -- data:${data}`);
    }

    return mid.toString();
  }

  async deleteMatch(id) {
    const filter = {
      _id: new ObjectId(id),
    };

    const result = await this._collectionMatch.deleteOne(filter);
  }

  async updateMatch(id, data) {
    const filter = {
      _id: new ObjectId(id),
    };

    let update = { $set: data };

    const result = await this._collectionMatch.updateOne(filter, update);
  }

  async deleteMatch(id) {
    const filter = {
      _id: new ObjectId(id),
    };

    const result = await this._collectionMatch.deleteOne(filter);
  }
}

class PlayerSourceJson {
  constructor(file) {
    this.players = {};
    this.playerBalance = {};
    this.dbData;
    this._mgdb = new mongoDB();
    this.matches = {};
    this.dq_list = {};
  }

  async getdb(pid = undefined, mid = undefined) {
    try {
      const arrs = await this._mgdb.getPlayer(pid);
      this.players = {};

      for (let player of arrs) {
        this.players[player._id] = player;
      }
    } catch (err) {}

    /**
     *     Match
     */

    try {
      const arrs = await this._mgdb.getMatch(mid);
      this.matches = {};

      for (let match of arrs) {
        match.entry_fee_usd_cents = Number(match.entry_fee_usd_cents);
        match.prize_usd_cents = Number(match.prize_usd_cents);

        if (match.p1_points === undefined) match.p1_points = 0;
        else match.p1_points = Number(match.p1_points);

        if (match.p2_points === undefined) match.p2_points = 0;
        else match.p2_points = Number(match.p2_points);

        match.p1_id = String(match.p1_id);
        match.p2_id = String(match.p2_id);

        if (match.ended_at === undefined) match.ended_at = null;

        this.matches[match._id] = match;

        if (!this.IsMatchActive(match._id) && match.is_dq)
          this.dq_list[match._id] =
            this.returnWinner(match._id) === "p1" ? "p2" : "p1";
      }
    } catch (err) {}
  }

  async createPlayer(data) {
    await this.getdb();
    let player = {};

    let date = new Date();

    player.created_at = date;

    if (data.fname != undefined) {
      player.fname = data.fname;
    }
    if (data.lname != undefined) {
      player.lname = data.lname;
    } else player.lname = "";

    if (data.is_active == null) player.is_active = true;
    else player.is_active = data.is_active;

    if (data.handed != undefined) {
      let handed = data.handed.toLowerCase();
      if (handed == "left") player.handed = "L";
      else if (handed == "right") player.handed = "R";
      else if (handed == "ambi") player.handed = "A";
      else player.handed = "err";
    }

    if (data.initial_balance_usd_cents != undefined) {
      player.balance_usd_cents = parseInt(data.initial_balance_usd_cents);
    }

    player.pid = await this._mgdb.createPlayer(player);

    this.players[player.pid] = player;

    return player.pid;
  }

  async updateBalance(pid) {
    if (this.players[pid] == undefined) {
      console.log("players pid is undefined");
      return -1;
    }

    await this._mgdb.updatePlayer(pid, this.players[pid]);

    return 1;
  }

  async updateMatch(mid) {
    await this.getdb();

    if (this.matches[mid] == undefined) {
      console.log("match mid is undefined");
      return -1;
    }
  }

  async updatePlayer(pid, data) {
    await this.getdb();

    if (this.players[pid] == undefined) {
      console.log("players pid is undefined");
      return -1;
    }

    console.log(data);

    if (data.is_active != undefined)
      this.players[pid].is_active = data.is_active;

    if (data.lname != undefined && data.lname != "") {
      this.players[pid].lname = data.lname;
    } else this.players[pid].lname = "";

    await this._mgdb.updatePlayer(pid, this.players[pid]);
    return 1;
  }
  async deletePlayer(pid) {
    await this.getdb();

    if (this.players[pid] == undefined) return false;
    else {
      await this._mgdb.deletePlayer(pid);
      delete this.players[pid];

      return true;
    }
  }

  async getBalance(pid) {
    await this.getdb();

    if (this.players[pid] == undefined) return undefined;
    else return this.players[pid].balance_usd_cents;
  }
  async getPlayers(active = "*") {
    await this.getdb();

    let arrs = [];

    for (const key in this.players) {
      let p = this.players[key];
      p = this.decorate_players_res(p);

      if (p != undefined) {
        if (active != "*" && active != p.is_active.toString()) continue;

        if (arrs.length == 0) arrs.push(p);
        else {
          let status = 0;

          // order
          for (let i = 0; i < arrs.length; i++) {
            if (
              (arrs[i].name[0] == p.name[0] && arrs[i].name[2] > p.name[2]) ||
              arrs[i].name[0] > p.name[0]
            ) {
              arrs.splice(i, 0, p);
              status = 1;
              break;
            } else continue;
          }

          if (!status) arrs.push(p);
        }
      }
    }
    return arrs;
  }

  async getPlayer(pid) {
    await this.getdb(pid);

    let player = this.players[pid];

    console.log(player);

    if (player == undefined) return undefined;
    else {
      return this.decorate_players_res(player);
    }
  }

  decorate_players_res(player) {
    let num_join = 0;
    let num_won = 0;
    let num_dq = 0;
    let total_points = 0;
    let total_prize = 0;
    let efficiency = 0.0;
    let in_active_match = 0;

    for (let key in this.matches) {
      let match = this.matches[key];
      let player_no = null;

      // if the player in the match
      if (match.p1_id === player._id) player_no = "p1";
      else if (match.p2_id === player._id) player_no = "p2";
      else continue;

      num_join++;
      if (player_no === "p1") total_points += match.p1_points;
      else if (player_no === "p2") total_points += match.p2_points;

      // if the match is active
      if (this.IsMatchActive(key)) in_active_match++;
      else {
        if (this.returnWinner(key) === player_no) {
          total_prize += match.prize_usd_cents;
          num_won++;
        } else {
          if (this.returnWinner(key) != "p1" && this.returnWinner(key) != "p2")
            throw new Error("in decorating player, winner err");
          if (this.dq_list[key] === player_no) num_dq++;
        }
      }
    }

    efficiency = num_won / num_join;

    if (efficiency > 1 || efficiency < 0)
      throw new Error("in decorating player, efficiency err");

    return {
      pid: player._id,
      name: `${this.returnName(player.fname, player.lname)}`,
      handed: `${this.returnHanded(player.handed)}`,
      is_active: player.is_active,
      num_join: num_join,
      num_won: num_won,
      num_dq: num_dq,
      balance_usd_cents: player.balance_usd_cents,
      total_points: total_points,
      total_prize_usd_cents: total_prize,
      in_active_match: in_active_match,
      efficiency: efficiency,
    };
  }

  returnName(fname, lname = "") {
    if (!lname) return fname;
    else return fname + " " + lname;
  }

  returnHanded(handed) {
    if (handed == "R") handed = "right";
    else if (handed == "L") handed = "left";
    else if (handed == "Ambi" || handed == "A") handed = "ambi";
    else handed = "undefined";

    return handed;
  }

  async getSearch(search) {
    await this.getdb();

    let q = search.split(";");
    let keyword = q[0];
    let nameReq = q[1].split(",");

    console.log("keyword = " + keyword);

    let isFname = false;
    let isLname = false;

    if (nameReq[0] == "fname") isFname = true;
    else if (nameReq[0] == "lname") isLname = true;

    if (nameReq[1] == "fname") isFname = true;
    else if (nameReq[1] == "lname") isLname = true;

    let arrs = [];

    keyword = decodeURIComponent(keyword);
    keyword = keyword.toLowerCase();

    for (let key in this.players) {
      let player = this.players[key];

      console.log(player);

      if (keyword == "") arrs.push(this.decorate_players_res(player));
      else if (isFname && player.fname.includes(keyword))
        arrs.push(this.decorate_players_res(player));
      else if (isLname && player.lname.includes(keyword))
        arrs.push(this.decorate_players_res(player));
    }

    console.log(arrs);

    return arrs;
  }

  /**
   *   Match
   */

  returnWinner(id) {
    if (this.IsMatchActive(id)) return null;
    else {
      if (this.dq_list[id] == null || this.dq_list[id] == undefined) {
        let match = this.matches[id];

        if (match.p1_points === match.p2_points) return "equal";
        else return match.p1_points > match.p2_points ? "p1" : "p2";
      } else if (this.dq_list[id] == "p1" || this.dq_list[id] == "p2") {
        return this.dq_list[id] == "p1" ? "p2" : "p1";
      } else {
        throw new Error(
          " in return Winner, dq_list neither p1, p2, null, nor undefined"
        );
      }
    }
  }

  decorate_match_res(match, dq = undefined) {
    let res = {};

    res.mid = match._id;
    res.entry_fee_usd_cents = match.entry_fee_usd_cents;

    res.p1_id = match.p1_id;

    res.p1_name = this.returnName(
      this.players[match.p1_id].fname,
      this.players[match.p1_id].lname
    );
    res.p1_points = match.p1_points;

    res.p2_id = match.p2_id;
    res.p2_name = this.returnName(
      this.players[match.p2_id].fname,
      this.players[match.p2_id].lname
    );
    res.p2_points = match.p2_points;

    let active = this.IsMatchActive(match._id);

    let winner = null;
    dq = false;

    if (!active) {
      winner = this.returnWinner(match._id);

      if (winner === null) winner = null;
      else if (winner === "equal")
        throw new Error(" in decorate match res, points should not be equal");
      else if (winner === "p1") winner = match.p1_id;
      else if (winner === "p2") winner = match.p2_id;
      else throw new Error(" in decorate match res, winner err");

      dq = this.IsDQ(res.mid);
    }

    res.winner_pid = winner;
    res.is_dq = dq;
    res.is_active = active;
    res.prize_usd_cents = match.prize_usd_cents;

    let create_seconds = new Date(match.created_at).getTime() / 1000;
    let now_seconds = new Date().getTime() / 1000;

    res.age = Math.round(now_seconds - create_seconds);
    res.ended_at = match.ended_at;

    return res;
  }

  IsPlayerExist(id) {
    if (this.players[id] === null)
      throw new Error(" player " + id + " should not be null");
    else return this.players[id] === undefined ? false : true;
  }

  IsPlayerActive(id) {
    return this.players[id].is_active;
  }

  IsMatchExist(id) {
    return this.matches[id] === undefined ? false : true;
  }

  IsPlayerInActiveMatch(id) {
    for (let key in this.matches) {
      if (this.matches[key].p1_id === id || this.matches[key].p2_id === id)
        return true;
    }

    return false;
  }

  IsMatchActive(id) {
    if (this.matches[id] === null)
      throw new Error(" match " + id + " should not be null");
    return this.matches[id].ended_at === null ||
      this.matches[id].ended_at === undefined
      ? true
      : false;
  }

  IsPlayerInMatch(mid, pid) {
    if (this.matches[mid].p1_id != pid && this.matches[mid].p2_id != pid)
      return false;
    else return true;
  }

  IsDQ(mid) {
    if (this.dq_list[mid] === undefined || this.dq_list[mid] === null)
      return false;
    else if (this.dq_list[mid] === "p1" || this.dq_list[mid] === "p2")
      return true;
    else throw new Error("in IsDQ, dq_list have weird value");
  }

  IsBalanceInsufficient(id, entry_fee) {
    if (this.players[id].balance_usd_cents < entry_fee) return false;
    else return true;
  }

  IsDollarValid(dollar) {
    if (dollar === undefined || !Number.isInteger(dollar) || dollar < 0)
      return false;
    else return true;
  }

  async createMatch(data) {
    await this.getdb();

    if (!this.IsPlayerExist(data.p1_id) || !this.IsPlayerExist(data.p2_id))
      return "unexist";
    else if (!this.IsDollarValid(data.prize_usd_cents)) return "err";
    else if (!this.IsDollarValid(data.entry_fee_usd_cents)) return "err";
    else if (
      !this.IsPlayerActive(data.p1_id) ||
      !this.IsPlayerActive(data.p2_id)
    )
      return "unactive";
    else if (
      this.IsPlayerInActiveMatch(data.p1_id) ||
      this.IsPlayerInActiveMatch(data.p2_id)
    )
      return "inmatch";
    else if (
      !this.IsBalanceInsufficient(data.p1_id, data.entry_fee_usd_cents) ||
      !this.IsBalanceInsufficient(data.p2_id, data.entry_fee_usd_cents)
    )
      return "insufficient";
    else {
      let match = {};

      let date = new Date();

      for (let key in data) match[key] = data[key];

      (match.created_at = date), (match.ended_at = null);
      match.is_dq = false;
      match.p1_points = 0;
      match.p2_points = 0;

      match.mid = await this._mgdb.createMatch(match);

      this.matches[match.mid] = match;

      this.players[match.p1_id].balance_usd_cents -= match.entry_fee_usd_cents;
      let tmp = {
        balance_usd_cents: this.players[match.p1_id].balance_usd_cents,
      };

      await this._mgdb.updatePlayer(match.p1_id, tmp);

      this.players[match.p2_id].balance_usd_cents -= match.entry_fee_usd_cents;
      tmp = { balance_usd_cents: this.players[match.p1_id].balance_usd_cents };

      await this._mgdb.updatePlayer(match.p2_id, tmp);

      return match.mid;
    }
  }

  async getActiveMatch(active) {
    await this.getdb();

    if (active === undefined) active = true;
    else active = active.toLowerCase();

    if (active === "true" || active === "1") active = true;
    else if (active === "false" || active === "0") active = false;
    else if (active === "*") active = "*";
    else active = true;

    let arrs = [];

    for (let key in this.matches) {
      if (this.IsMatchActive(key) == active || active === "*")
        arrs.push(this.matches[key]);
      else continue;
    }

    return arrs;
  }

  async getMatchById(id) {
    await this.getdb();

    if (!this.IsMatchExist(id)) return null;
    else {
      let data = this.decorate_match_res(this.matches[id]);
      return data;
    }
  }

  async postPoints(mid, pid, points) {
    await this.getdb();

    if (!this.IsMatchExist(mid) || !this.IsPlayerExist(pid)) return "notexist";
    else if (!this.IsPlayerInMatch(mid, pid)) return "notinmatch";
    else if (!this.IsMatchActive(mid)) return "notactive";
    else {
      if (pid === this.matches[mid].p1_id) {
        this.matches[mid].p1_points += points;
        await this._mgdb.updateMatch(mid, {
          p1_points: this.matches[mid].p1_points,
        });
      } else if (pid === this.matches[mid].p2_id) {
        this.matches[mid].p2_points += points;
        await this._mgdb.updateMatch(mid, {
          p2_points: this.matches[mid].p2_points,
        });
      } else throw new Error("in post points err");

      return "success";
    }
  }

  async endMatch(id) {
    await this.getdb();

    if (!this.IsMatchExist(id)) return "notexist";
    else if (!this.IsMatchActive(id)) return "notactive";
    else if (this.matches[id].p1_points === this.matches[id].p2_points)
      return "tied";
    else {
      let date = new Date();
      this.matches[id].ended_at = date;

      let update = {
        ended_at: date,
      };

      await this._mgdb.updateMatch(id, update);

      await this.getdb();

      let winner_pid =
        this.matches[id].p1_points > this.matches[id].p2_points
          ? this.matches[id].p1_id
          : this.matches[id].p2_id;

      await this.updateWinner(winner_pid, id);

      return "success";
    }
  }

  async updateWinner(pid, mid) {
    this.players[pid].balance_usd_cents += this.matches[mid].prize_usd_cents;
    await this._mgdb.updatePlayer(pid, {
      balance_usd_cents: this.players[pid].balance_usd_cents,
    });
  }

  async disqualify(mid, pid) {
    await this.getdb();

    if (!this.IsMatchExist(mid) || !this.IsPlayerExist(pid)) return "notexist";
    else if (!this.IsMatchActive(mid)) return "notactive";
    else if (!this.IsPlayerInMatch(mid, pid)) return "notinmatch";
    else {
      let date = new Date();
      this.matches[mid].ended_at = date;

      let winner_pid;

      if (pid === this.matches[mid].p1_id) {
        this.dq_list[mid] = "p1";
        winner_pid = this.matches[mid].p2_id;
      } else if (pid === this.matches[mid].p2_id) {
        this.dq_list[mid] = "p2";
        winner_pid = this.matches[mid].p1_id;
      } else throw new Error("in disqualify, pid not exist in matches");

      await this._mgdb.updateMatch(mid, { ended_at: date, is_dq: true });
      await this.updateWinner(winner_pid, mid);

      return "success";
    }
  }

  async reactiveMatch(mid) {
    await this.getdb();

    if (!this.IsMatchExist(mid)) return "notexist";
    else if (this.IsMatchActive(mid)) return "active";
    else {
      if (!this.dq_list[mid] === undefined && !this.dq_list[mid] === null)
        this.dq_list[mid] = null;

      this.matches[mid].ended_at = null;
      await this._mgdb.updateMatch(mid, { ended_at: null });

      return "success";
    }
  }

  async getActiveMatchArray(active) {
    await this.getdb();
    let arrs = await this.getActiveMatch(active);
    let results = [];

    // insertion sort
    for (let match of arrs) {
      if (results.length === 0) results[0] = match;
      else {
        let flag = false;
        for (let i = 0; i < results.length; i++) {
          if (match.prize_usd_cents >= results[i].prize_usd_cents) {
            if (i === 0) results.unshift(match);
            else {
              results.splice(i, 0, match);
              results.join();
            }

            flag = true;
            break;
          }
        }

        if (!flag) results.push(match);
      }
    }

    let decorated_results = [];

    for (let ele of results) {
      decorated_results.push(this.decorate_match_res(ele));
    }
    return decorated_results;
  }

  async deleteMatch(mid) {
    await this.getdb();

    if (this.matches[mid] == undefined) return false;
    else {
      delete this.players[mid];
      await this._mgdb.deleteMatch(mid);
    }

    return true;
  }

  async decorate_player_graphQL(pid) {
    //here

    let player = await this.getPlayer(pid);

    let player_res = player;

    player_res.fname = this.players[pid].fname;
    player_res.lname = this.players[pid].lname;

    return player;
  }
}

let psj = new PlayerSourceJson();

function queryHelper(query) {
  // chect query
  let err_msg = "invalid fields: ";
  if (query.fname == undefined) err_msg += "fname, ";
  else if (query.fname.length == 0) err_msg += "fname, ";
  else {
    for (let n of query.fname) {
      if ((n >= "a" && n <= "z") || (n >= "A" && n <= "Z")) continue;
      else {
        err_msg += "fname, ";
        break;
      }
    }
  }

  if (query.lname != undefined) {
    for (let n of query.lname) {
      if ((n >= "a" && n <= "z") || (n >= "A" && n <= "Z")) continue;
      else {
        err_msg += "lname, ";
        break;
      }
    }
  }

  if (query.initial_balance_usd_cents == undefined)
    err_msg += "balance_usd_cents, ";
  else {
    let usd_cents = parseFloat(query.initial_balance_usd_cents);
    if (usd_cents < 0 || usd_cents != parseInt(usd_cents))
      err_msg += "balance_usd_cents, ";
  }
  if (query.handed == undefined) err_msg += "handed, ";
  else {
    let handed = query.handed.toLowerCase();
    if (handed != "left" && handed != "right" && handed != "ambi")
      err_msg += "handed, ";
  }

  if (err_msg != "invalid fields: ")
    err_msg = err_msg.substring(0, err_msg.length - 2);
  return err_msg;
}

const resolvers = {
  Query: {
    player: async (_, { pid }) => {
      const player = await psj.decorate_player_graphQL(pid);
      return player || null;
    },

    players: async (_, { is_active, q }) => {
      const activeStr = is_active !== undefined ? String(is_active) : "*";
      const allPlayers = await psj.getPlayers(activeStr);

      if (!q) return allPlayers;

      // simple search filter
      const keyword = q.toLowerCase();
      return allPlayers.filter(
        (p) =>
          p.fname.toLowerCase().includes(keyword) ||
          p.lname.toLowerCase().includes(keyword)
      );
    },

    match: async (_, { mid }) => {
      const match = await psj.getMatchById(mid);
      return match || null;
    },

    matches: async (_, { is_active }) => {
      const active = is_active !== undefined ? is_active : true;
      const matches = await psj.getActiveMatchArray(active);
      return matches;
    },

    dashboard: async () => {
      // simple dashboard example
      const allPlayers = await psj.getPlayers("*");
      const numTotal = allPlayers.length;
      const numActive = allPlayers.filter((p) => p.is_active).length;
      const numInactive = numTotal - numActive;
      const avgBalance =
        numTotal > 0
          ? Math.floor(
              allPlayers.reduce((sum, p) => sum + p.balance_usd_cents, 0) /
                numTotal
            )
          : 0;

      return {
        player: {
          avg_balance_usd_cents: avgBalance,
          num_total: numTotal,
          num_active: numActive,
          num_inactive: numInactive,
        },
      };
    },
  },

  Mutation: {
    matchAward: async (obj, input, context) => {
      let mid = input.mid;
      let pid = input.pid;
      let points = input.points;

      if (points == undefined || points <= 0 || String(Number(points)) == "NaN")
        throw new GraphQLError("Invalid points value");
      else {
        points = Number(points);

        let status = await psj.postPoints(mid, pid, points);

        if (status === "notactive") throw new GraphQLError(" not active");
        else if (status === "notexist") throw new GraphQLError(" not exist");
        else if (status === "success") {
          let data = psj.decorate_match_res(psj.matches[mid]);
          return data;
        } else throw new GraphQLError(" unknown err ");
      }
    },

    matchCreate: async (obj, input) => {
      if (input == undefined) throw new Error("in post match, body is empty");
      else {
        input.p1_id = input.pid1;
        input.p2_id = input.pid2;

        let id = await psj.createMatch(input);

        if (id === "unexist") throw new Error("not exist");
        else if (id === "unactive") throw new Error("not active");
        else if (id === "insufficient") throw new Error("insufficient");
        else if (id === "err") throw new Error("err");
        else {
          let data = psj.decorate_match_res(psj.matches[id]);
          return data;
        }
      }
    },

    matchDisqualify: async (obj, input) => {
      let mid = input.mid;
      let pid = input.pid;

      let status = await psj.disqualify(mid, pid);

      if (status === "notexist") return NULL;
      else if (status === "notactive") return NULL;
      else if (status === "success") {
        let data = psj.decorate_match_res(psj.matches[mid]);

        return data;
      } else return NULL;
    },

    matchEnd: async (obj, input) => {
      let mid = input.mid;

      let status = await psj.endMatch(mid);

      if (status === "notexist") return NULL;
      else if (status === "notactive" || status === "tied") return NULL;
      else if (status === "success") {
        let data = psj.decorate_match_res(psj.matches[mid]);

        return data;
      } else return NULL;
    },

    playerCreate: async (obj, { playerInput }, context) => {
      let err_msg = queryHelper(playerInput);

      if (err_msg == "invalid fields: ") {
        let id = await psj.createPlayer(playerInput);
        let res = await psj.decorate_player_graphQL(id);

        return res;
      } else {
        return NULL;
      }
    },

    playerDelete: async (obj, input) => {
      let pid = input.pid;

      let status = await psj.deletePlayer(pid);

      if (!status) throw new GraphQLError("err");
      else return true;
    },

    playerDeposit: async (obj, input) => {
      let id = input.pid;
      let amount_usd_cents = input.amount_usd_cents;

      if (amount_usd_cents == undefined || amount_usd_cents <= 0)
        throw new GraphQLError("cents err");

      let old_usd_cents = await psj.getBalance(id);

      if (old_usd_cents === undefined) throw new GraphQLError(" old cents err");

      let new_usd_cents = amount_usd_cents + old_usd_cents;

      psj.playerBalance = {
        old_balance_usd_cents: old_usd_cents,
        new_balance_usd_cents: new_usd_cents,
      };

      psj.players[id].balance_usd_cents = new_usd_cents;

      await psj.updateBalance(id);

      psj.players[id].pid = psj.players[id]._id;

      return psj.players[id];
    },

    playerUpdate: async (obj, req) => {
      //here

      let id = req.pid;

      let input = req.playerInput;

      let status = await psj.updatePlayer(id, input);

      if (status == -1) return null;

      let res = await psj.decorate_player_graphQL(id);

      return res;
    },
  },
};

const schema = makeExecutableSchema({
  resolvers,
  resolverValidationOptions: {
    requireResolversForAllFields: "ignore",
  },
  // resolverValidationOptions: {
  //   requireResolversForAllFields: 'warn',
  //   requireResolversToMatchSchema: 'warn',
  // },
  typeDefs,
});

(async function () {
  app.get("/ping", (req, res) => {
    res.status(204).end();
  });

  app.use(
    "/graphql",
    graphqlHTTP({
      schema,
      graphiql: true,
    })
  );
  app.listen(3000);
  console.log("GraphQL API server running at http://localhost:3000/graphql");
})();
