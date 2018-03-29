const url = require("url");
const crypto = require("crypto");
const BN = require("bn.js");
const StratumClient = require("./lib/StratumClient");
const argv = require("minimist")(process.argv.slice(2));

function sha256(data) {
	const hash = crypto.createHash("sha256");
	hash.update(data);
	return hash.digest();
}

function build_merkle_root(merkle_branch, coinbase_hash_bin) {
	let merkle_root = coinbase_hash_bin;

	for(let h of merkle_branch) {
		merkle_root = sha256(sha256(Buffer.concat([
			merkle_root,
			Buffer.from(h, "hex")
		])));
	}

	return merkle_root;
}

function reverse(a) {
	const b = Buffer.alloc(a.length);

	for(let i = 0; i < a.length; i++) {
		b[a.length - i - 1] = a[i];
	}

	return b;
}

async function main() {
	const { hostname, port } = new url.URL(argv.o);
	const username = argv.u;
	const password = argv.p;

	const stratum = new StratumClient(port, hostname);

	let subscriptionDetails;
	let extranonce1;
	let extranonce2_size;
	let extranonce2;
	let difficulty;
	let target;

	let job_id;
	let ntime;

	let nonce;
	let block_header;

	let mining = false;
	let lastLog;
	let hashes;

	function lessThan(a, b) {
		for(let i = 0; i < a.length; i++) {
			if(a[i] < b[i])
				return true;

			if(a[i] > b[i])
				return false;
		}
	}

	function mine() {
		block_header.writeUInt32LE(nonce++, block_header.length - 4);

		const hash = sha256(block_header);

		if(lessThan(hash, target)) {
			(async () => {
				console.log("Submitting share");

				let result;

				try {
					result = await stratum.send("submit", username, job_id, extranonce2.toString("hex"), ntime, block_header.slice(block_header.length - 4).toString("hex"));
				} catch(err) {
					result = false;
				}

				console.log(result ? "Accepted share" : "Denied Share");
			})();
		}

		hashes++;
	}

	function loop() {
		for(let i = 0; i < 10000; i++) {
			mine();
		}

		setTimeout(loop, 0);
	}

	function startMining() {
		if(mining === false) {
			hashes = 0;
			lastLog = Date.now();

			loop();

			setInterval(() => {
				const hashRate = hashes / ((Date.now() - lastLog) / 1000);

				console.log(`${hashRate.toFixed(2)}/sec`);
				hashes = 0;
				lastLog = Date.now();
			}, 1000);

			mining = true;
		}
	}

	stratum.on("mining.set_difficulty", _difficulty => {
		difficulty = _difficulty;

		const maxTarget = new BN("00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", 16);
		target = maxTarget.div(new BN(difficulty.toString(), 10)).toBuffer("be", 32);

		console.log("Received new difficulty:", difficulty);
	});

	stratum.on("mining.notify", (...args) => {
		const [
			_job_id,
			prevhash,
			coinb1,
			coinb2,
			merkle_branch,
			version,
			nbits,
			_ntime,
			clean_jobs
		] = args;

		job_id = _job_id;
		ntime = _ntime;

		const coinbase = Buffer.concat([
			Buffer.from(coinb1, "hex"),
			Buffer.from(extranonce1, "hex"),
			extranonce2,
			Buffer.from(coinb2, "hex")
		]);

		const coinbase_hash_bin = sha256(coinbase);
		const merkle_root = build_merkle_root(merkle_branch, coinbase_hash_bin);

		block_header = Buffer.concat([
			reverse(Buffer.from(version.toString(), "hex")),
			reverse(Buffer.from(prevhash, "hex")),
			reverse(merkle_root),
			reverse(Buffer.from(ntime, "hex")),
			reverse(Buffer.from(nbits, "hex")),
			Buffer.alloc(4)
		]);

		nonce = 0;

		console.log("Received new work");

		startMining();
	});

	[ subscriptionDetails, extranonce1, extranonce2_size ] = await stratum.send("mining.subscribe");
	extranonce2 = crypto.randomBytes(extranonce2_size);

	await stratum.send("mining.authorize", username, password);
}

main().catch(e => console.log(e));
