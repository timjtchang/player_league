# Player League

A GraphQL-based API for managing a player league, handling players, matches, and statistics.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **API:** GraphQL (using `express-graphql`)
- **Database:** MongoDB
- **Containerization:** Docker & Docker Compose

## Project Structure

```text
player_league/
├── config/
│   └── mongo.json          # Database configuration
├── src/
│   ├── db/
│   │   └── MongoWrapper.js # MongoDB connection and wrapper
│   ├── graphql/
│   │   ├── resolvers.js    # GraphQL resolvers
│   │   └── schema.graphql  # GraphQL type definitions
│   ├── services/
│   │   ├── MatchService.js # Business logic for matches
│   │   └── PlayerService.js# Business logic for players
│   └── server.js           # Application entry point
├── .gitignore
├── docker-compose.yml      # Docker services configuration
├── index.js                # Legacy entry point (deprecated)
├── package.json
├── package-lock.json
└── README.md
```

## Functionality

### Player Handling

- **Create Player:** Register new players with their name, handedness (Left, Right, Ambi), and initial balance.
- **Update Player:** Modify player details such as active status and last name.
- **Delete Player:** Remove a player from the league.
- **Get Player(s):** Retrieve individual player details or a list of players. Supports filtering by active status and searching by name.
- **Deposit:** Add funds to a player's balance.
- **Statistics:** Automatically calculates:
  - Efficiency (Wins / Joins)
  - Number of matches joined
  - Number of matches won
  - Number of disqualifications
  - Total points earned
  - Total prize money won

### Match Handling

- **Create Match:** Set up a match between two players.
  - Validates player existence and active status.
  - Checks if players are already in an active match.
  - Verifies players have sufficient balance for the entry fee.
  - Deducts entry fee from both players upon creation.
- **End Match:** Conclude a match.
  - Determines the winner based on points.
  - Awards the prize money to the winner.
  - Records the end time.
- **Disqualify:** Disqualify a player from an active match. The opponent is automatically declared the winner.
- **Award Points:** Add points to a specific player during a match.
- **Get Match(s):** Retrieve details for a specific match or a list of matches (active or history).

### Dashboard

- Provides high-level league statistics:
  - Average player balance.
  - Count of active, inactive, and total players.

## Usage

### Prerequisites

- Node.js
- Docker & Docker Compose

### Setup

1.  **Start the Database:**
    Use Docker Compose to start the MongoDB container.

    ```bash
    docker-compose up -d
    ```

2.  **Configuration:**
    Ensure `config/mongo.json` is configured correctly (default provided):

    ```json
    { "host": "localhost", "port": "27017", "db": "player_league" }
    ```

3.  **Install Dependencies:**

    ```bash
    npm install
    ```

4.  **Start the Server:**

    ```bash
    npm start
    ```
    *Note: This runs `src/server.js`.*

5.  **Access the API:**
    The GraphQL Playground is available at:
    [http://localhost:3000/graphql](http://localhost:3000/graphql)

## Example Queries

### Get All Players

```graphql
query {
  players {
    pid
    name
    balance_usd_cents
    efficiency
  }
}
```

### Create a Match

```graphql
mutation {
  matchCreate(
    p1_id: "PLAYER_1_ID"
    p2_id: "PLAYER_2_ID"
    entry_fee_usd_cents: 100
    prize_usd_cents: 200
  ) {
    mid
    is_active
  }
}
```
