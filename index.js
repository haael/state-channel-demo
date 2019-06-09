


const Web3 = require('web3');
const fs = require('fs');
const axios = require('axios');
const readline = require('readline');

const build_contracts = require('./build_contracts');
const abiExtension = build_contracts.abiExtension;
const bytecodeExtension = build_contracts.bytecodeExtension;



var contractRebuilt = build_contracts.buildContracts();


const ethnetwork = "https://ropsten.infura.io/v3/42ff785509d74434bcb329e81365f3a7";
const web3 = new Web3(new Web3.providers.HttpProvider(ethnetwork));

console.log("web3.js", web3.version);
console.log("Network:", ethnetwork);

//console.log(web3);

var connected = web3.currentProvider.connected;
console.log("Connected:", connected);
if(!connected) throw "not connected";


var privateKey;

async function loadAccount(name, save) {
	const keyFileName = name + '.priv.key';
	var account;
	if(fs.existsSync(keyFileName)) {
		account = web3.eth.accounts.privateKeyToAccount(fs.readFileSync(keyFileName, 'utf8'));
	} else {
		account = web3.eth.accounts.create();
		fs.writeFileSync(keyFileName, account.privateKey, 'utf8');
	}
	
	if(save) {
		web3.eth.accounts.wallet.add(account);
		console.log("Added address to wallet: " + account.address, "balance: " + (await web3.eth.getBalance(account.address)));
	}
	return account;
}










function Channel() {
	this.senderAddress = "";
	this.recipientAddress = "";
	this.balance = 0;
	this.funds = 0;
	this.senderCounter = 0;
	this.recipientCounter = 0;
}
	
Channel.prototype.read = async function() {
	if(!this.contract.address) throw "Contract not mined yet.";

	this.senderAddress = await this.contract.methods.channelSender().call();
	this.recipientAddress = await this.contract.methods.channelRecipient().call();
	this.balance = await this.contract.methods.balance().call();
	this.funds = await this.contract.methods.funds().call();
	this.senderCounter = await this.contract.methods.senderSerial().call();
	this.recipientCounter = await this.contract.methods.recipientSerial().call();
}

Channel.prototype.transfer = function(value) {
	if(this.senderAddress.toLowerCase() == web3.eth.defaultAccount.toLowerCase())
		return this.transferToRecipient(value);
	if(this.recipientAddress.toLowerCase() == web3.eth.defaultAccount.toLowerCase())
		return this.transferToSender(value);
	else
		throw "You are not recipient nor sender.";
}

Channel.prototype.transferToRecipient = function(value) {
	if(this.balance.add(value).gt(this.funds)) throw "Not enough funds";
	this.balance = this.balance.add(value);
	this.senderCounter = this.senderCounter.add(1);
	return { balance: this.balance.toString(), senderSerial: this.senderCounter.toString(), recipientSerial: this.recipientCounter.toString(), signature: this.signature() };
}

Channel.prototype.transferToSender = function(value) {
	if(this.balance.lt(value)) throw "Not enough funds";
	this.balance = this.balance.sub(value);
	this.recipientCounter = this.recipientCounter.add(1);
	return { balance: this.balance.toString(), senderSerial: this.senderCounter.toString(), recipientSerial: this.recipientCounter.toString(), signature: this.signature() };
}

Channel.prototype.signature = function() {
	const message = web3.eth.abi.encodeParameters(['address', 'uint', 'uint', 'uint'], [this.contract.address, this.balance, this.senderCounter, this.recipientCounter]);
	const sig = web3.eth.accounts.sign(message, privateKey);
	return [ sig.r, sig.s, sig.v ];
}

Channel.prototype.accept = function(transfer) {
	const oldBalance = this.balance;
	const oldSenderCounter = this.senderCounter;
	const oldRecipientCounter = this.recipientCounter;
	
	this.balance = new (this.balance.constructor)(transfer.balance);
	this.senderCounter = new (this.senderCounter.constructor)(transfer.senderSerial);
	this.recipientCounter = new (this.recipientCounter.constructor)(transfer.recipientSerial);
	
	const r = transfer.signature[0];
	const s = transfer.signature[1];
	const v = transfer.signature[2];
	const message = web3.eth.abi.encodeParameters(['address', 'uint', 'uint', 'uint'], [this.contract.address, this.balance, this.senderCounter, this.recipientCounter]);
	//console.log(message, v, r, s);
	const signer = web3.eth.accounts.recover(message, v, r, s);
	
	var ok = false;
	
	if(this.senderAddress.toLowerCase() == web3.eth.defaultAccount.toLowerCase() && signer.toLowerCase() == this.recipientAddress.toLowerCase()) {
		ok = true;
		if(!this.senderCounter.eq(oldSenderCounter)) ok = false;
		if(this.recipientCounter.lte(oldRecipientCounter)) ok = false;
	} else if(this.recipientAddress.toLowerCase() == web3.eth.defaultAccount.toLowerCase() && signer.toLowerCase() == this.senderAddress.toLowerCase()) {
		ok = true;
		if(this.senderCounter.lte(oldSenderCounter)) ok = false;
		if(!this.recipientCounter.eq(oldRecipientCounter)) ok = false;
	} else {
		ok = false;
	}
	
	if(this.balance.gt(this.funds)) ok = false;
	if(this.balance.lt(0)) ok = false;
	
	if(!ok) {
		this.balance = oldBalance;
		this.senderCounter = oldSenderCounter;
		this.recipientCounter = oldRecipientCounter;
	}
	return ok;
}

Channel.prototype.update = async function() {
	const sig = this.signature();
	const r = sig[0];
	const s = sig[1];
	const v = sig[2];
	
	const transaction = this.contract.methods.UpdateChannel(this.balance, this.senderCounter, this.recipientCounter, v, r, s);
	var gas;
	try {
		gas = await transaction.estimateGas();
	} catch(error) {
		gas = 2000000;
	}

	console.log("Updating channel state (" + gas + " gas)...");
	const event = transaction.send({gas: gas});
	
	const result = await new Promise(function(resolve, reject) {
		event.on('error', (error) => { reject(error); })
		     .on('confirmation', (confirmationNumber, receipt) => {
				console.log(receipt);
				resolve(0);
				event.removeAllListeners('confirmation');
		     });
	});

	console.log("Channel update transaction result: " + result);
	return result;
}

Channel.prototype.close = async function() {
	const transaction = this.contract.methods.CloseChannel();
	var gas;
	try {
		gas = await transaction.estimateGas();
	} catch(error) {
		gas = 2000000;
	}
	
	console.log("Closing channel (" + gas + " gas)...");
	const event = transaction.send({gas: gas});
	
	const result = await new Promise(function(resolve, reject) {
		event.on('error', (error) => { reject(error); })
		     .on('confirmation', (confirmationNumber, receipt) => {
				console.log(receipt);
				resolve(0);
				event.removeAllListeners('confirmation');
		     });
	});

	//console.log("Channel close transaction id: " + result);
	return result;
}


Channel.prototype.deploy = async function(senderAddress, recipientAddress, timeout, initialfunds) {
	const channelABI = JSON.parse(fs.readFileSync("Channel" + abiExtension, 'utf8'));
	const channelBytecode = "0x" + fs.readFileSync("Channel" + bytecodeExtension, 'utf8');
	const contract = web3.eth.Contract(channelABI);
	const deployment = contract.deploy({arguments: [senderAddress, recipientAddress, timeout], data: channelBytecode})
	const gas = await deployment.estimateGas();
	const tcnt = await web3.eth.getTransactionCount(web3.eth.defaultAccount, 'pending');
	this.contract = contract;
	console.log("Deploying contract... (" + gas + " gas).", tcnt);
	
	const event = deployment.send({gas: gas, nonce: tcnt, value: initialfunds});	
	event.on('error', (error) => { throw error; })
	     .on('confirmation', (confirmationNumber, receipt) => {
			console.log("new contract address: " + receipt.options.address);
			this.contract.address = receipt.options.address;
			event.removeAllListeners('confirmation');
	     });
	
	return this;
}


Channel.prototype.open = async function(channelAddress) {
	const channelABI = JSON.parse(fs.readFileSync("Channel" + abiExtension, 'utf8'));
	this.contract = web3.eth.Contract(channelABI, channelAddress);
	await this.read();
	return this;
}


Channel.prototype.deposit = async function(value) {
	if(!this.contract.address) throw "Contract not mined yet.";
	const tcnt = await web3.eth.getTransactionCount(web3.eth.defaultAccount, 'pending');
	const transaction = {to: this.contract.address, value: value, gas:50000, nonce:tcnt};
	console.log(privateKey);
	const signed = await web3.eth.accounts.signTransaction(transaction, privateKey);
	console.log("Deposit funds into contract: ", this.contract.address, value);
	//try {
		const txid = web3.eth.sendSignedTransaction(signed.rawTransaction);
		//console.log("Channel deposit transaction id: " + txid);
	//} catch(error) {
		// ignore bug in web3.js
	//}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

Channel.prototype.mined = async function(timeout) {
	console.log("Waiting for a contract to be mined (" + timeout + "s timeout)");
	
	while((!this.contract.address) && timeout >= 0) {
		//console.log("address:", this.contract.address, timeout);
		await sleep(1000);
		timeout -= 1;
	}
	
	if(this.contract.address)
		return this.contract.address;
	else
		throw "timeout";
}




async function waitForBalance(address, timeout) {
	var balance = await web3.eth.getBalance(address);
	
	while((balance == 0) && timeout >= 0) {
		balance = await web3.eth.getBalance(address);
		//await sleep(1000);
		timeout -= 1;
	}
	
	return balance;
}


async function getRopstenFunds(address) {
	//curl -X POST  -H "Content-Type: application/json" -d '{"toWhom":"0xb436ba50d378d4bbc8660d312a13df6af6e89dfb"}' https://ropsten.faucet.b9lab.com/tap
	console.log("Requesting funds from Ropsten faucet to account " + address);
	const response = await axios.post('https://ropsten.faucet.b9lab.com/tap', {toWhom: address});
	console.log(response.data);
	// TODO: wait for confirmation
}




async function makeChannel() {
	console.log("contract rebuilt:", contractRebuilt);


	const account = await loadAccount("creator", true);
	web3.eth.defaultAccount = account.address;
	privateKey = account.privateKey;
	
	const accounts = await web3.eth.getAccounts();
	console.log("accounts: ", accounts);
	for(let n in accounts) {
		const address = accounts[n];
		const balance = await web3.eth.getBalance(address);
		console.log(address, balance);
		if(balance == 0) {
			await getRopstenFunds(address);
			await waitForBalance(address, 90);
			console.log("new balance:", (await web3.eth.getBalance(address)));
		}
	}
	
	var channel;
	if(contractRebuilt) {	
		const accountA = (await loadAccount("userA")).address;
		const accountB = (await loadAccount("userB")).address;		
		channel = await new Channel().deploy(accountA, accountB, 3600, 0);
		await channel.mined(90);
		fs.writeFileSync('contract.txt', channel.contract.address, 'utf8');
	} else {
		const contractAddress = fs.readFileSync('contract.txt', 'utf8');
		channel = await new Channel().open(contractAddress);
		console.log("channel address verify:", channel.contract.address);
	}
	
	await channel.deposit(web3.utils.toWei('0.001', 'ether'));
	await channel.read();
	
	return channel;
}



function readLine(prompt) {
	return new Promise(function(resolve, reject) {
		const rl = readline.createInterface({
		    input: process.stdin,
		    output: process.stdout
		});
		
		rl.question(prompt, (value) => {
			resolve(value);
		    rl.close();
		});
	});
}


async function main() {
	web3.eth.defaultGas = 1000000;
	var lastBlock = await web3.eth.getBlock('latest');
	console.log("Last block:", lastBlock.number, lastBlock.hash);
	
	const channel = await makeChannel();
	console.log("using channel:", channel.contract.address);
	
	const user = "user" + (await readLine("User A or B? ")).toUpperCase();
	const account = await loadAccount(user, true);
	web3.eth.defaultAccount = account.address;
	privateKey = account.privateKey;
	const accounts = await web3.eth.getAccounts();
	for(let n in accounts) {
		const address = accounts[n];
		const balance = await web3.eth.getBalance(address);
		console.log(address, balance);
		if(balance == 0) {
			await getRopstenFunds(address);
			await waitForBalance(address, 90);
			console.log("new balance:", (await web3.eth.getBalance(address)));
		}
	}
	
	await channel.read();
	console.log("Type '?' for help.");
	var running = true;
	while(running) {
		console.log();
		console.log("total funds:", web3.utils.fromWei(channel.funds.toString(), 'ether') + "ETH", "balance:", web3.utils.fromWei(channel.balance.toString(), 'ether') + "ETH");
		const cmd = await readLine("> ");
		
		if(cmd == '?') {
			console.log("<number> - send funds");
			console.log("<paste json> - accept funds");
			console.log("s - save channel state to blockchain");
			console.log("r - read channel state from blockchain");
			console.log("c - close channel");
			console.log("? - help");
			console.log("q - quit");
		} else if(cmd == 'q') {
			running = false;
		} else if(cmd == 's') {
			await channel.update();
		} else if(cmd == 'r') {
			await channel.read();
		} else if(cmd == 'c') {
			await channel.close();
			fs.unlinkSync('contract.txt');
		} else {
			try {
				const value = web3.utils.toWei(cmd, 'ether');
				try {
					const trans = channel.transfer(value);
					console.log(JSON.stringify(trans));
				} catch(error) {
					console.log(error);
				}
			} catch(error) {
				//console.log(error);
				try {
					const trans = JSON.parse(cmd);
					try {
						if(!channel.accept(trans))
							console.log("transfer not accepted");
					} catch(error) {
						console.log(error);
					}
				} catch(error) {
					console.log("unknown command");
				}
			}
			
		}
	}
}


main().then(() => { process.exit(); });




