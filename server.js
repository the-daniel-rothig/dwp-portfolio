var https       = require('https'),
    airtable    = require('airtable'),
    path        = require('path'),
    fs          = require('fs'),
    merge       = require('merge'),
    express     = require('express'),
    browserSync = require('browser-sync'),
    nunjucks    = require('express-nunjucks'),
    _           = require('underscore'),
    routes      = require(__dirname + '/app/routes.js'),
    dis_routes  = require(__dirname + '/app/views/display/routes.js'),
    favicon     = require('serve-favicon'),
    app         = express(),
    port        = process.env.PORT || 3100,
    env         = process.env.NODE_ENV || 'development';

/*
  Load all the project data from the files.
*/
var defaults = JSON.parse(fs.readFileSync(__dirname + '/lib/projects/defaults.js').toString());
var files = fs.readdirSync(__dirname + '/lib/projects/');
app.locals.data = [];
_.each(files,function(el)
{
  if (el == 'defaults.js') return;
  var file = fs.readFileSync(__dirname + '/lib/projects/'+el).toString();
  try {
    var json = merge(true,defaults,JSON.parse(file));
    json.filename = el;
    app.locals.data.push(json);
  } catch(err) {
    console.log(err);
  }
});

/*
  BIS data loader
*/

(function() {
  airtable.configure({
    apiKey: "key6m6cFaeSbYB8gU"
  });
  var bisBase = airtable.base("appidn9pd0LDCemue");

  var alldata = {err: null, data: null};

  var bisDataCallbacks = [];

  var triggerAllCallbacks = function() {
    for (var i in bisDataCallbacks) {
      bisDataCallbacks[i](alldata.err, alldata.data);
    }
    bisDataCallbacks = [];
  }

  var getAll = function() {
        bisBase('Activity Tier 1').select().firstPage(function(t1err, t1results) {
          if (t1err) {
            alldata = {err: t1err, data: alldata.data};
            triggerAllCallbacks();
          }
          var themes = {};
          for (var i in t1results) {
            themes[t1results[i].get('Activity Tier 1 ID')] = t1results[i].get('Activity Tier 1 Title');
          }
          bisBase('Activity Tier 2').select({
            maxRecords:200
          }).firstPage(function(err, results) {
            if (err) {
              alldata = {err: err, data: alldata.data};
              triggerAllCallbacks();
            };
            var data = _.filter(_.map(results, function(x) {return formatBisProject(x, themes)}), function(x) {return !!x});
            alldata = {err: err, data: data};
            triggerAllCallbacks();
        });
      });
    } 

  getAll();
  setInterval(getAll, 60 * 1000);

  app.locals.bisdata = {
    getProject: function (id, callback) {
        bisDataCallbacks.push(function(err, data) {
          var project = _.find(data, function(x) {return x.id === id;});
          if (!project) err = "Unknown ID";
          callback(err, project);
        });
        if (alldata.data) {
          triggerAllCallbacks();
        }
    }, getAll: function(callback) {
        bisDataCallbacks.push(callback);
        if (alldata.data) {
          triggerAllCallbacks();
        }    
    } 
  }

  function formatBisProject(r, themes) {
    if (!r || !r.get('Activity T2 ID')) return null;
    var stage = (r.get('Current Stage') || "");
    var stageLower = stage.toLowerCase();
    var phase =  
       ["approved", "discovery", "initiated", "initiation", "planning","planning build", "pre-alpha", "pre-contract", "procurement"].indexOf(stageLower) > -1 ? "discovery"
      :["alpha", "in progress"].indexOf(stageLower) > -1 ? "alpha"
      :["beta", "delivery", "live beta", "private beta", "testing", "underway"].indexOf(stageLower) > -1 ? "beta"
      :["complete", "final delivery", "live", "nearing completion"].indexOf(stageLower) > -1 ? "live"
      :"backlog";

    var theme = r.get('Activity T1 ID');
    var theme = (themes && themes[theme]) || theme; 
    var formatted = {
            id: r.get('Activity T2 ID').slice(3),
            name: r.get('Activity Tier 2 Title'),
            description: r.get('Activity Tier 2 Description'),
            theme: theme, //r.get('Activity Tier 1 Name')[0],
            themeid: parseInt(r.get('Activity T1 ID').slice(3)),
            location: r.get('Organisation')[0],
            phase: phase,
            facing: 'user', //todo: data
            sro: r.get('SRO (T2)'),
            service_man: r.get('Programme Lead'),
            priority: "High"
          };
    var phaseHistory = {};
    phaseHistory[phase] = [
      {label: stage, date: r.get('Stage Start Date') || "unknown start date" }
    ];
    if (r.get('Stage End Date')) phaseHistory[phase].push({label: "Predicted", date: r.get('Stage End Date')});
    
    formatted["phase-history"] = phaseHistory;
    return formatted;
  }
})();
// Application settings
app.set('view engine', 'html');
app.set('views', [__dirname + '/app/views/', __dirname + '/lib/']);

// Middleware to serve static assets
app.use('/public', express.static(__dirname + '/public'));
app.use('/public', express.static(__dirname + '/govuk_modules/govuk_template/assets'));
app.use('/public', express.static(__dirname + '/govuk_modules/govuk_frontend_toolkit'));
app.use('/public/images/icons', express.static(__dirname + '/govuk_modules/govuk_frontend_toolkit/images'));

nunjucks.setup({
    autoescape: true,
    watch: true
}, app, function(env) {
  env.addFilter('slugify', function(str) {
      return str.replace(/[.,-\/#!$%\^&\*;:{}=\-_`~()’]/g,"").replace(/ +/g,'_').toLowerCase();
  });
});

// Elements refers to icon folder instead of images folder
app.use(favicon(path.join(__dirname, 'govuk_modules', 'govuk_template', 'assets', 'images','favicon.ico')));

// send assetPath to all views
app.use(function (req, res, next) {
  // res.locals.assetPath="/public/";
  res.locals.asset_path="/public/";
  next();
});

// routes (found in app/routes.js)
if (typeof(routes) != "function"){
  console.log(routes.bind);
  console.log("Warning: the use of bind in routes is deprecated - please check the prototype kit documentation for writing routes.")
  routes.bind(app);
} else {
  app.use("/", dis_routes);
  app.use("/", routes);
}

// auto render any view that exists
app.get(/^\/([^.]+)$/, function (req, res)
{
	var path = (req.params[0]);

  // remove the trailing slash because it seems nunjucks doesn't expect it.
  if (path.substr(-1) === '/') path = path.substr(0, path.length - 1);

	res.render(path, req.data, function(err, html)
  {
		if (err) {
			res.render(path + "/index", req.data, function(err2, html)
      {
        if (err2) {
          res.status(404).send(path+'<br />'+err+'<br />'+err2);
        } else {
          res.end(html);
        }
      });
		} else {
			res.end(html);
		}
	});
});

// start the app
if (env === 'production') {
  app.listen(port);
} else {
  // for development use browserSync as well
  app.listen(port,function()
  {
    browserSync({
      proxy:'localhost:'+port,
      files:['public/**/*.{js,css}','app/views/**/*.html'],
      ghostmode:{clicks:true, forms: true, scroll:true},
      open:false,
      port:(port+1),
    });
  });
}

console.log('');
console.log('Listening on port ' + port);
console.log('');
