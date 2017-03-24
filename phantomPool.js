var cluster = require("cluster");

if (cluster.isMaster) {
    var cpuCount = require('os').cpus().length;

    for (var i = 0; i < cpuCount; i++) {
        console.log('Forking process #' + (i + 1));
        cluster.fork();
    }

    cluster.on('exit', function(worker) {
        console.log('Worker ' + worker.id + ' died. Forking...');
        cluster.fork();
    });

} else {
    var genericPool = require('generic-pool'),
        express = require("express"),
        phantom = require('phantom'),
        bodyParser = require('body-parser'),
        server = express();

    // server.use(bodyParser.json());


    var opts = {
        max: 3, // maximum number of resources to create at any given time.
        min: 1, // minimum number of resources to keep in pool at any given time.
        testOnBorrow: true, //an instance is validated (among maxUses) before it is acquired
        phantomArgs: [
            ['--ignore-ssl-errors=true', '--disk-cache=true'], {
                logLevel: 'debug',
            }
        ], //phantom arguments
        // specifies how long a resource can stay idle in pool before being removed
        idleTimeoutMillis: 30000
    };

    var maxUses = 30;

    const factory = {
        create: () => phantom.create()
            .then(instance => {
                instance.useCount = 0;
                return instance;
            }),
        destroy: (instance) => instance.exit(),
        validate: function(instance) {
            console.log('useCount: ' + instance.useCount + " maxUses: " + maxUses);
            return Promise.resolve(true && (maxUses <= 0 || instance.useCount < maxUses))
        }
    };



    var pool = genericPool.createPool(factory, opts);

    server.get('/generatepdf', function(req, res) {
        var url = req.query.url;
        console.log(req.url);


        var resourcePromise = pool.acquire();
        resourcePromise.then(function(ph) {
                ph.useCount += 1;
                console.log('acquiring phantom instance with use count: ', ph.useCount);
                ph.createPage().then(function(page) {

                    page.open(url).then(function(status) {

                        if (!status) {
                            page.close();
                            pool.release(ph);
                            res.json({
                                processPID: process.pid,
                                pageStatus: "failed"
                            });
                            return;
                        }

                        if (status === "success") {
                            console.log('hurra....taking snapshot');

                            var hrstart = process.hrtime();
                            page.render('google-' + new Date().getTime() + "-" + process.pid + ".pdf");

                            console.log('releasing instance');
                            pool.release(ph);
                            res.json({
                                processPID: process.pid,
                                pageStatus: status
                            });
                        }
                    });
                });
            })
            .catch(function(err) {
                //handle error - this is generally a timeout or maxWaitingClients
                //error
            });
    }).listen(4444);
}
