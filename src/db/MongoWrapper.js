const { MongoClient, ObjectId } = require("mongodb");
const fs = require("fs");
const path = require("path");

class MongoWrapper {
  constructor() {
    const configPath = path.join(process.cwd(), "config", "mongo.json");
    let data;

    try {
      const res = fs.readFileSync(configPath);
      data = JSON.parse(res);
    } catch (err) {
      console.error("Failed to load mongo config:", err);
      process.exit(1);
    }

    const uri = `mongodb://${data.host}:${data.port}`;
    this.client = new MongoClient(uri);

    this.client
      .connect()
      .then(() => console.log("Connected to MongoDB"))
      .catch((err) => {
        console.error("Failed to connect to MongoDB:", err);
        process.exit(5);
      });

    const database = this.client.db(data.db);
    this._collection = database.collection("player");
    this._collectionMatch = database.collection("match");
  }

  /** PLAYER OPERATIONS */
  async getPlayer(id) {
    if (!id) return null;
    const player = await this._collection.findOne({ _id: new ObjectId(id) });
    if (player) player._id = player._id.toString();
    return player;
  }

  async getAllPlayers(activeOnly = false) {
    const query = activeOnly ? { is_active: true } : {};
    let data = await this._collection.find(query).toArray();
    return data.map((p) => ({ ...p, _id: p._id.toString() }));
  }

  async createPlayer(data) {
    const { insertedId: mid } = await this._collection.insertOne(data);
    if (!mid) throw new Error(`Error insert player -- data:${data}`);
    return mid.toString();
  }

  async deletePlayer(id) {
    return await this._collection.deleteOne({ _id: new ObjectId(id) });
  }

  async updatePlayer(id, data) {
    const filter = { _id: new ObjectId(id) };
    const update = {
      $set: {
        is_active: data.is_active,
        lname: data.lname,
        balance_usd_cents: parseInt(data.balance_usd_cents),
      },
    };
    return await this._collection.updateOne(filter, update);
  }

  /** MATCH OPERATIONS */
  async getMatchesByPlayer(pid) {
    const query = {
      $or: [{ p1_id: pid }, { p2_id: pid }],
    };
    let data = await this._collectionMatch.find(query).toArray();
    return data.map((m) => ({ ...m, _id: m._id.toString() }));
  }

  async createMatch(data) {
    const { insertedId: mid } = await this._collectionMatch.insertOne(data);
    if (!mid) throw new Error(`Error insert Match -- data:${data}`);
    return mid.toString();
  }

  async updateMatch(id, data) {
    const filter = { _id: new ObjectId(id) };
    return await this._collectionMatch.updateOne(filter, { $set: data });
  }

  async deleteMatch(id) {
    return await this._collectionMatch.deleteOne({ _id: new ObjectId(id) });
  }
}

module.exports = MongoWrapper;
