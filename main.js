const childProcess = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const PACKAGED = true;

const SAVE_FILE = path.join(
    PACKAGED ? path.dirname(process.execPath) : __dirname,
    'ip.txt'
);

// Configure console.debug
let debug = false;
console.debug = (...args) => {
    if (debug) {
        console.log(...args);
    }
};

let connectedIP = null;

class Util {
    static exec(cmd) {
        return new Promise((resolve, reject) => {
            childProcess.exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                } else if (
                    stderr.length > 0 &&
                    !stderr
                        .toLowerCase()
                        .includes('daemon started successfully')
                ) {
                    reject(new Error(`Stderr: ${stderr}`));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    static input(prompt) {
        return new Promise(resolve => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question(prompt, answer => {
                rl.close();
                resolve(Util.clean(answer));
            });
        });
    }

    static clean(str) {
        return str.replace(/\r/g, '').trim();
    }

    static saveIP(ip) {
        fs.writeFileSync(SAVE_FILE, ip);
    }

    static getIP() {
        if (fs.existsSync(SAVE_FILE)) {
            return Util.clean(fs.readFileSync(SAVE_FILE, 'utf-8'));
        } else {
            return null;
        }
    }

    static async getAndSaveIP() {
        const ip = await Adb.getIP();
        console.debug(`Saving device IP: ${ip}`);
        Util.saveIP(ip);
        return ip;
    }

    static setConnectedIP(ip) {
        if (connectedIP && !ip) {
            console.log(`Disconnected from ${connectedIP}`);
        } else if (!connectedIP && ip) {
            console.log(`Connected to ${ip}`);
        }
        connectedIP = ip;
    }
}

class Adb {
    static async listDevices() {
        const out = await Util.exec('adb devices');
        const devices = Util.clean(out)
            .split('\n')
            .slice(1)
            .map(line => line.split('\t'));
        return devices;
    }

    static tcpip() {
        return Util.exec('adb tcpip 5555');
    }

    static async getIP() {
        const out = await Util.exec('adb shell ip -f inet addr show wlan0');
        return Util.clean(out)
            .split('\n')[1]
            .trim()
            .split(' ')[1]
            .split('/')[0];
    }

    static disconnectAll() {
        Util.setConnectedIP(null);
        return Util.exec('adb disconnect');
    }

    static async connect(ip) {
        const out = await Util.exec(`adb connect ${ip}:5555`);
        const clean = Util.clean(out).toLowerCase();
        if (!clean.startsWith(`connected to ${ip}`)) {
            throw new Error(`Failed to connect to ${ip}`);
        }
    }

    static reset() {
        Util.setConnectedIP(null);
        return Util.exec('adb kill-server');
    }
}

async function checkStatus() {
    console.debug('Checking status');

    let devices = await Adb.listDevices();

    console.debug('Devices:', devices);

    // Disconnect devices if offline
    if (devices.filter(d => d[1] === 'offline').length > 0) {
        console.debug('Detected offline devices, disconnecting all');
        await Adb.disconnectAll();
        devices = devices.filter(d => !d[0].endsWith('5555'));
    }

    // Filter devices
    devices = devices.map(d => d[0]);
    const ipDevices = [];
    const wireDevices = [];
    devices.forEach(name => {
        if (name.endsWith(':5555')) {
            ipDevices.push(name);
        } else {
            wireDevices.push(name);
        }
    });

    // If multiple ip devices, disconnect all
    if (ipDevices.length > 1) {
        console.debug('Multiple IP devices found, disconnecting all');
        await Adb.disconnectAll();
        devices = wireDevices;
        ipDevices = [];
    }

    // Unplug quest if multiple devices connected
    if (devices.length > 1 && wireDevices.length > 0) {
        console.log('Please unplug Quest from computer');
        return;
    }

    // Final multiple devices check
    if (devices.length > 1) {
        console.log('Error: multiple devices detected');
        return;
    }

    /* Now we for sure have 0 or 1 devices connected */

    // Handle IP device
    if (ipDevices.length === 1) {
        console.debug('Detected IP device, verifying connection');
        try {
            const ip = await Adb.getIP();
            console.debug('Connection verified');
            if (ip !== connectedIP) {
                Util.saveIP(ip);
                Util.setConnectedIP(ip);
            }
        } catch (e) {
            console.debug('Bad connection, resetting adb');
            await Adb.reset();
            console.debug('Reset');
            await checkStatus();
        }
        return;
    }

    // Handle wired device
    let ip;
    if (wireDevices.length === 1) {
        console.debug('Detected wired device');

        // Save IP
        ip = await Util.getAndSaveIP();

        // Set IP mode
        await Adb.tcpip();
    } else {
        ip = Util.getIP();
    }

    // Attempt IP connection
    console.debug('Attempting IP connection');
    if (ip == null) {
        console.log(
            'Could not get IP address, please connect Quest to computer'
        );
        return;
    }
    try {
        console.log(`Connecting to ${ip}...`);
        await Adb.connect(ip);
        Util.setConnectedIP(ip);
        if (wireDevices.length > 0) {
            console.log('Please disconnected Quest from computer');
        }
    } catch (e) {
        console.log(`Failed to connect to ${ip}`);
    }
}

function checkLoop() {
    const delay = () => {
        setTimeout(checkLoop, 5 * 1000);
    };
    checkStatus()
        .then(delay)
        .catch(err => {
            console.error(err);
            delay();
        });
}

const HELP = {
    debug: 'Toggle debug printing',
    adb: 'Run adb commands'
};

async function main() {
    checkLoop();

    while (true) {
        const input = await Util.input('');
        const args = input.toLowerCase().split(' ');
        const cmd = args.splice(0, 1)[0];

        if (cmd === 'help') {
            let help = [];
            Object.keys(HELP).forEach(c => {
                help.push(`  ${c} - ${HELP[c]}`);
            });
            console.log(help.join('\n'));
        } else if (cmd === 'debug') {
            debug = !debug;
            console.log(`${debug ? 'Enabled' : 'Disabled'} debug printing`);
        } else if (cmd === 'adb') {
            try {
                const out = await Util.exec([cmd, ...args].join(' '));
                console.log(out);
            } catch (e) {
                console.error(e.message);
            }
        }
    }
}

main().catch(console.error);
