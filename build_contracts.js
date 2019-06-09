

const solc = require('solc');
const fs = require('fs');


const contractNames = ["Channel"];
const sourceFiles = ["Channel.sol"];
const abiExtension = ".abi.json";
const bytecodeExtension = ".bytecode";


function compileContract(sourceFiles) {
	console.log("Compiling contracts");

	var input = {
	    language: 'Solidity',
	    sources: {
	    },
	    settings: {
	        outputSelection: {
	            '*': {
	                '*': [ '*' ]
	            }
	        }
	    }
	};
	
	for (let fileNo in sourceFiles)
		input['sources'][sourceFiles[fileNo]] = { content: fs.readFileSync(sourceFiles[fileNo], 'utf8') };

	const output = JSON.parse(solc.compile(JSON.stringify(input)));

	if(output.errors) {
	    output.errors.forEach(err => {
	        console.log(err.formattedMessage);
	    });
		return false;
	} else {
		for (let fileNo in sourceFiles) {
			const sourceFile = sourceFiles[fileNo];
		    const contracts = output.contracts[sourceFile];
		    for (let contractName in contracts) {
		        const contract = contracts[contractName];
				console.log(contract.evm.gasEstimates);
		        fs.writeFileSync(contractName + abiExtension, JSON.stringify(contract.abi, null, 2), 'utf8');
		        fs.writeFileSync(contractName + bytecodeExtension, contract.evm.bytecode.object, 'utf8');
		    }
		}
		return true;
	}
}

function checkContractVersions(sourceFiles, contractNames) {
	
	var sourceVersion = 0;
	
	for (let fileNo in sourceFiles) {
		const sourceFile = sourceFiles[fileNo];
	
		if(!fs.existsSync(sourceFile))
			throw "Source file not found: " + sourceFile;
		else {
			var v;
			v = new Date(fs.statSync(sourceFile).mtime).getTime();
			if (v > sourceVersion) sourceVersion = v;
		}
	}
	
	var compiledVersion = Date.now();

	//console.log("contract names: " + contractNames);
	
	for (let contractNo in contractNames) {
		const contractName = contractNames[contractNo];

		//console.log(contractName + " " + fs.existsSync(contractName + abiExtension) + " " + fs.existsSync(contractName + bytecodeExtension));
	
		if(!fs.existsSync(contractName + abiExtension) || !fs.existsSync(contractName + bytecodeExtension)) {
			//console.log("one of compiled files missing");
			compiledVersion = -1;
			break;
		} else {
			var v;
			v = new Date(fs.statSync(contractName + abiExtension).mtime).getTime();
			if (v < compiledVersion) compiledVersion = v;
			v = new Date(fs.statSync(contractName + bytecodeExtension).mtime).getTime();
			if (v < compiledVersion) compiledVersion = v;
		}
	}

	return sourceVersion < compiledVersion;
}

function buildContracts() {
	console.log("Building contracts");
	if(!checkContractVersions(sourceFiles, contractNames)) {
		if(!compileContract(sourceFiles))
			throw "Error compiling contracts.";
		
		if(!checkContractVersions(sourceFiles, contractNames))
			throw "Contract build failed despite compilation attempt (missing source?).";
		
		return true;
	}
	
	return false;
}


module.exports = {
	contractNames: contractNames,
	sourceFiles: sourceFiles,
	abiExtension: abiExtension,
	bytecodeExtension: bytecodeExtension,
	compileContract: compileContract,
	checkContractVersions: checkContractVersions,
	buildContracts: buildContracts
};

