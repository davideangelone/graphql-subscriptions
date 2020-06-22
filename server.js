const express = require('express');
const { ApolloServer, gql, PubSub } = require('apollo-server-express');
const http = require('http');

// Objects for output
class Message {
  constructor(id_message, {content}, author) {
    this.id_message = id_message;
    this.content = content;
	this.author = author;
  }
}

class Author {
  constructor(id_author, {name, age, nationality}) {
    this.id_author = id_author;
    this.name = name;
    this.age = age;
	this.nationality = nationality;
  }
}


// Maps of objects
// map id_message -> Message
let messages = {};

//Map name -> Author
let authors = {};

//Map id_author -> id_message
let authorMessages = {};


const pubsub = new PubSub();
const MESSAGE_CREATED_SUBSCRIPTION = 'Message_Created_Subscription';


// The GraphQL schema in string form
const typeDefs = gql`
  input MessageInput {
    content: String
    author: AuthorInput!
  }
  
  input AuthorInput {
	name: String!
	age: Int
	nationality: String
  }
  
  
  type Message {
    id_message: ID!
    content: String
	author: Author!
  }
  
  type Author {
	id_author: ID!
	name: String!
	age: Int
	nationality: String
  }

  type Query {
    getMessage(id_message: ID!): Message
	listMessages(author_name: String!): [Message]
	listAuthors: [Author]
	countMessages: Int
	countAuthors: Int
  }

  type Mutation {
    createMessage(input: MessageInput): Message
    updateMessage(id_message: ID!, content: String): Message
  }
  
  # The subscription root type, specifying what we can subscribe to
  type Subscription {
    messageCreated: Message!
   }
  
`;

// The resolvers
const resolvers = {
  Query: {
  
	  getMessage: (parent, {id_message}) => {
		if (!messages[id_message]) {
		  throw new Error('no message exists with id ' + id_message);
		}
		return messages[id_message];
	  },
	  listMessages: (parent, {author_name}) => {
		if (!authors[author_name]) {
		  throw new Error('no authors exists with name ' + author_name);
		}
		
		id_author = authors[author_name].id_author;
		if (!authorMessages[id_author]) {
		  throw new Error('no messages exists for author with name ' + author_name);
		}
		
		var messagesFound = [];
		
		authorMessages[id_author].forEach(id_msg => {
			messagesFound.push(messages[id_msg]);
		});
		
		return messagesFound;
	  },
	  listAuthors: () => {
		return Object.values(authors);
	  },
	  countMessages: () => {
		return Object.keys(messages).length;
	  },
	  countAuthors: () => {
		return Object.keys(authors).length;
	  }
  },
  Mutation : {
	  createMessage: (parent, {input}) => {
	
		if (!authors[input.author.name]) {
			// Create random id for author
			var id_author = require('crypto').randomBytes(10).toString('hex');		
			authors[input.author.name] = new Author(id_author, input.author);
		}
		
		// Create random id for message
		var id_message = require('crypto').randomBytes(10).toString('hex');	
		var id_author = authors[input.author.name].id_author;
		message = new Message(id_message, input, authors[input.author.name]);
		messages[id_message] = message;
		
		if (!authorMessages[id_author]) {
			authorMessages[id_author] = [];
		}
		authorMessages[id_author].push(id_message);
		
		pubsub.publish(MESSAGE_CREATED_SUBSCRIPTION, message);
		
		return message;
	  },
	  updateMessage: (parent, {id_message, content}) => {
		if (!messages[id_message]) {
		  throw new Error('no message exists with id ' + id_message);
		}
		// This replaces all old data, but some apps might want partial update.
		messages[id_message].content = content;
		return messages[id_message];
	  }
  },
  
  Subscription: {
	  messageCreated: {  // create a messageCreated subscription resolver function.
		resolve: (message) => {
			return { 
						id_message : message.id_message,
						content : message.content,
						author : {
							id_author : message.author.id_author,
							name : message.author.name,
							age : message.author.age,
							nationality : message.author.nationality
						}
					};
		},
		subscribe: (parent, args, context, info) => {
			console.log('Subscription (' + info.fieldName + ') created');
			return pubsub.asyncIterator(MESSAGE_CREATED_SUBSCRIPTION);  // subscribe to creating messages
		}
	  }
  }
};


// Initialize the app
const PORT = 4000;
const app = express();
const path = '/graphql';
const subscriptionsPath = '/subscriptions';


const server = new ApolloServer({
  typeDefs,
  resolvers,
  playground: {
    endpoint: path,
    subscriptionEndpoint: subscriptionsPath,
	/*
    tabs: [
      {
        endpoint: string
        query: string
        variables?: string
        responses?: string[]
        headers?: { [key: string]: string }
      },
    ],
	*/
  },
  
  subscriptions: {
	path : subscriptionsPath,
	
    onConnect: async (connectionParams, webSocket, context) => {
      console.log("Client [" + context.request.connection.remoteAddress + ":" + context.request.connection.remotePort + "] connected to subscriptions");
    },
    onDisconnect: (webSocket, context) => {
		if (context.request.connection.remoteAddress) {
			console.log("Client [" + context.request.connection.remoteAddress + ":" + context.request.connection.remotePort + "] disconnected from subscriptions");
		}
    },
  },
  
  plugins : [
   {
      serverWillStart() {
        console.log('Server starting up!');
      },
	  requestDidStart(requestContext) {
		  if (requestContext.request && requestContext.request.operationName != 'IntrospectionQuery' && requestContext.request.query.indexOf('IntrospectionQuery') == -1) {
				var data = new Date().toLocaleString('it-IT');
				console.log('[' + data + '] [' + requestContext.context.ip + '] Request headers : ' + JSON.stringify(requestContext.context.headers, null, 4));
				console.log('[' + data + '] [' + requestContext.context.ip + '] Request body : ' + JSON.stringify(requestContext.request, null, 4));
		  }
	  }
    }
  ],
  
  formatResponse: (response, requestContext) => {
	if (!response.data.__schema) {
		var data = new Date().toLocaleString();
		console.log('[' + data + '] [' + requestContext.context.ip + '] Response body :' + JSON.stringify(response, null, 4));
	}
    return response;
  },
  
  context : ( ({req}) => {
	if (req) {
		return { headers : req.headers, ip : req.ip, remoteAddress : req.connection.remoteAddress } 
	}	
  })
	
});

server.applyMiddleware({ app, path });

const httpServer = http.createServer(app);
server.installSubscriptionHandlers(httpServer);

// Start the server
httpServer.listen(PORT, () => {
  console.log('Running a GraphQL API server at http://localhost:' + PORT + server.graphqlPath);
  console.log('Subscriptions ready at ws://localhost:' + PORT + server.subscriptionsPath);
});


