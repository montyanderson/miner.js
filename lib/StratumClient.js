const EventEmitter = require("events").EventEmitter;
const net = require("net");

class StratumClient extends EventEmitter {
	constructor(port, host) {
		super();

		this.socket = net.connect(port, host);
		this.handlers = {};
		this.id = 0;

		let buffer = "";

		this.socket.on("data", data => {
			buffer += data;
			const parts = buffer.split("\n");

			buffer = parts.pop();

			for(let part of parts) {
				const object = JSON.parse(part);

				if("result" in object) {
					const handler = this.handlers[object.id];

					if(object.error === null) {
						handler.resolve(object.result);
					} else {
						handler.reject(new Error(handler.error));
					}
				}

				if("params" in object) {
					this.emit(object.method, ...object.params);
				}

			}
		});
	}

	async send(method, ...params) {
		return await new Promise((resolve, reject) => {
			const id = this.id++;

			this.handlers[id] = { resolve, reject };

			this.socket.write(JSON.stringify({
				id,
				method,
				params
			}) + "\n");
		});
	}
}

module.exports = StratumClient;
