const {app, BrowserWindow, ipcMain, clipboard, Menu} = require('electron')
app.allowRendererProcessReuse = true

const fs = require('fs')
const Store = require('electron-store')

const store = new Store()

let proxy // Defined later when an option is chosen
const resourcesPath = fs.existsSync('resources/app')
    ? 'resources/app/' // Packaged with electron-forge
    : './' // npm start


const javaProxy = require('./proxy/java/proxy.js')
const bedrockProxy = require('./proxy/bedrock/proxy.js')
const packetHandler = require('./packetHandler.js')
const setupDataFolder = require('./setupDataFolder.js')

const electronLocalShortcut = require('electron-localshortcut')
const windowStateKeeper = require('electron-window-state')
const unhandled = require('electron-unhandled')

const osDataFolder = app.getPath('appData')

const dataFolder = setupDataFolder.setup(osDataFolder, resourcesPath)

function makeMenu(direction, text, id) {
    if (direction !== 'clientbound' && direction !== 'serverbound') {
        // This probably isn't a packet
        return
    }

    const menuData = [
        {
            icon: resourcesPath + `icons/${direction}.png`,
            label: text,
            enabled: false
        },
        {
            type: 'separator'
        },
        {
            label: proxy.capabilities.jsonData ? 'Copy JSON data' : 'Copy data',
            click: () => {
                BrowserWindow.getAllWindows()[0].send('copyPacketData', JSON.stringify({
                    id: id
                }))
            }
        },
        {
            label: 'Edit and resend',
            click: () => {
                BrowserWindow.getAllWindows()[0].send('editAndResend', JSON.stringify({
                    id: id
                }))
            },
            visible: proxy.capabilities.modifyPackets
        },
        {
            label: 'Hide all packets of this type',
            click: () => {
                BrowserWindow.getAllWindows()[0].send('hideAllOfType', JSON.stringify({
                    // Packet ID from link URL
                    id: id
                }))
            }
        }
    ]

    if (text.split(' ')[1] === 'position' && direction === 'clientbound') {
        menuData.splice(3, 0,
            {
                label: 'Copy teleport as command',
                click: () => {
                    BrowserWindow.getAllWindows()[0].send('copyTeleportCommand', JSON.stringify({
                        id: id
                    }))
                }
            }
        )
    }

    if (proxy.capabilities.rawData) {
        menuData.splice(3, 0,
            {
                label: 'Copy hex data',
                click: () => {
                    BrowserWindow.getAllWindows()[0].send('copyHexData', JSON.stringify({
                        id: id
                    }))
                }
            }
        )
    }

    return Menu.buildFromTemplate(menuData)
}

function createWindow() {
    // Let us register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state

    // Create the browser window.
    const win = new BrowserWindow({
        height: store.get('authConsentGiven') ? 535 : 691,
        width: 500,
        resizable: false,
        // frame: false,
        webPreferences: {
            nodeIntegration: true
        },
        icon: resourcesPath + 'icons/icon.png'
    })

    win.setMenu(null)
    // and load the index.html of the app.
    win.loadFile('html/startPage/index.html')
    // Open the DevTools.
    // win.webContents.openDevTools()
    electronLocalShortcut.register(win, 'F12', () => {
        win.openDevTools()
    })

    unhandled({
        logger: (err) => {
            win.send('error', JSON.stringify({msg: err.message, stack: err.stack}))
            console.log(err.stack)
            console.error(err)
        },
        showDialog: false
    });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        if (proxy) {
            proxy.end()
        }
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

ipcMain.on('startProxy', (event, arg) => {
    const ipcMessage = JSON.parse(arg)
    if (ipcMessage.platform === 'java') {
        proxy = javaProxy
    } else {
        proxy = bedrockProxy
    }

    const win = BrowserWindow.getAllWindows()[0]

    packetHandler.init(BrowserWindow.getAllWindows()[0], ipcMain, proxy)
    proxy.startProxy(ipcMessage.connectAddress, ipcMessage.connectPort, ipcMessage.listenPort, ipcMessage.version,
      ipcMessage.consent, packetHandler.packetHandler, packetHandler.messageHandler , dataFolder, () => {
          win.send('updateFiltering', '')
      })

    win.loadFile('html/mainPage/index.html')

    // Load the previous state with fallback to defaults
    const mainWindowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800
    });

    win.setResizable(true)
    win.setPosition(mainWindowState.x, mainWindowState.y)
    win.setSize(mainWindowState.width, mainWindowState.height)

    mainWindowState.manage(win)
})

ipcMain.on('proxyCapabilities', (event, arg) => {
    event.returnValue = JSON.stringify(proxy.capabilities)
})

ipcMain.on('copyToClipboard', (event, arg) => {
    clipboard.writeText(arg)
})

ipcMain.on('contextMenu', (event, arg) => {
    const ipcMessage = JSON.parse(arg)
    makeMenu(ipcMessage.direction, ipcMessage.text, ipcMessage.id).popup(BrowserWindow.getAllWindows()[0])
})

ipcMain.on('relaunchApp', (event, arg) => {
    app.relaunch()
    app.exit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.