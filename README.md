# QuestConnector
QuestConnector automates the process connecting to your Oculus Quest by running the following commands:
```
$ adb tcpip 5555
$ adb connect <ip address>:5555
```
It will save your Quest's IP address and attempt to reconnect whenever it is disconnected.
## Dependencies
* Install [ADB](https://developer.android.com/studio/command-line/adb) and add to path