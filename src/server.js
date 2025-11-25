const express = require("express");
const { graphqlHTTP } = require("express-graphql");
const { readFileSync } = require("fs");
const path = require("path");
const { makeExecutableSchema } = require("@graphql-tools/schema");

const ps = require("./services/PlayerService");
const ms = require("./services/MatchService");

const resolvers = require("./graphql/resolvers");

const app = express();

const schemaPath = path.join(__dirname, "./graphql/schema.graphql");
const typeDefs = readFileSync(schemaPath).toString("utf-8");

const schema = makeExecutableSchema({
  resolvers,
  typeDefs,
  resolverValidationOptions: {
    requireResolversForAllFields: "ignore",
  },
});

(async function () {
  try {
    console.log("Booting up...");
    await Promise.all([ps.init(), ms.init()]);

    app.get("/ping", (req, res) => res.status(204).end());

    app.use(
      "/graphql",
      graphqlHTTP({
        schema,
        graphiql: true,
      })
    );

    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/graphql");
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
