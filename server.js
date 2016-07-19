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
    apiKey: process.env.AIRTABLE_KEY
  });
  var bisBase = airtable.base("appidn9pd0LDCemue");

  // a queue for data requests in case pages are requested before the data has been cached
  // (possibly a tad overengineered)
  function BisData() {
    var alldata = {err: null, data: null, themeDescriptions: null};
    var bisDataCallbacks = [];
    
    var triggerAllCallbacks = function() {
      for (var i in bisDataCallbacks) {
        bisDataCallbacks[i](alldata.err, alldata.data, alldata.themeDescriptions);
      }
      bisDataCallbacks = [];
    }

    this.push = function(callback) {
      if (alldata.data) {
        callback(alldata.err, alldata.data, alldata.themeDescriptions);
      } else {
        bisDataCallbacks.push(callback);
      }
    }
    
    this.setData = function(data, themeDescriptions) {
      alldata = {err: null, data: data, themeDescriptions: themeDescriptions};
      triggerAllCallbacks();
    }

    this.setError = function(err) {
      alldata = {err: err, data:alldata.data, themeDescriptions: alldata.themeDescriptions};
      triggerAllCallbacks();
    }
  }

  var bisData = new BisData();

  var getAll = function() {
    getAllRows([
      bisBase('Activity Tier 1').select(),
      bisBase('Activity Tier 2').select({filterByFormula: 'AND(NOT({Phase} = ""), NOT({Phase} = "Other"), NOT({Omit from public dashboard} = "Omit"))'}),
      bisBase('Activity Tier 3').select()], function(err, spreadsheets) {
        if (err) {
          bisData.setError(err);
          return;
        }
        var tempT1 = spreadsheets[0], // Tier 1
            tempT2 = spreadsheets[1], // Tier 2
            tempT3 = spreadsheets[2]; // Tier 3

        // Tier 1 data is interpreted as themes, providing the projects with metadata to get grouped by
        var themeOrder = ['BIS HQ', 'Skills Funding Agency', 'UKSBS', 'Innovate UK', 'RCUK', 'MRC (RCUK)', 'BBSRC (RCUK)', 'NERC (RCUK)', 'STFC (RCUK)', 'PSU (AHRC, EPSRC ESRC)'];
        var themes = {};
        for (var i in tempT1) {
          var idx = themeOrder.indexOf(tempT1[i].get('Activity Tier 1 Title'));
          themes[tempT1[i].get('Activity Tier 1 ID')] = {
            title: tempT1[i].get('Activity Tier 1 Long Name'),
            location: tempT1[i].get('Location'),
            cardinality: idx < 0 ? 30000 : idx + 1
          }
        }

        var data = _.filter(_.map(tempT2, function(x) {
          // Tier 3 data is interpreted as project steps
          var steps = _.filter(tempT3, function(y){return y.get('Activity Tier 2 ID') === x.get('Activity T2 ID')});
          
          // most of the data comes from Tier 2: each row is treated as a portfolio project
          return formatBisProject(x, steps, themes)
        }), function(x) {return !!x});
      
        // metadata needed for populating the index page
        var themeDescriptions = {};
        for (var i in tempT1) {
          var idx = themeOrder.indexOf(tempT1[i].get('Activity Tier 1 Title'));
          themeDescriptions[tempT1[i].get('Activity Tier 1 Long Name')] = tempT1[i].get('Activity Tier 1 Public Description') || "";
        }

        bisData.setData(data, themeDescriptions);
    });
  };

  // This function sequentially retrieves all rows of multiple Airtable tables
  // (identified by their .select() return values) and finally invokes a callback
  // with any error OR an array of arrays, where the outer array is the tables
  // and the inner array is the rows.
  function getAllRows(airtableSelects, callback, _resultsSoFar) {
    var tmp = [];
    _resultsSoFar = _resultsSoFar || [];

    airtableSelects[0].eachPage(function page(results, nextPage) {
      tmp = tmp.concat(results);
      nextPage();
    }, function done(err) {
      if (err) {
        callback(err, null);
        return;
      }
      _resultsSoFar.push(tmp);
      if (airtableSelects.length > 1) {
        // recursion happens here: the select just processed gets removed from the array
        // of selects, its results carried across in _resultsSoFar.
        getAllRows(airtableSelects.slice(1), callback, _resultsSoFar);
      } else {
        callback(null, _resultsSoFar);
      }
    });
  }

  // cache and regularly refresh portfolio data
  getAll();
  setInterval(getAll, 60 * 1000);

  // access to portfolio data
  app.locals.bisdata = {
    getProject: function (id, callback) {
        bisData.push(function(err, data) {
          var project = _.find(data, function(x) {return x.id === id;});
          if (!project) err = "Unknown ID";
          callback(err, project);
        });
    }, getAll: function(callback) {
        bisData.push(callback);
    } 
  };

  function formatBisProject(r,  steps, themes) {
    if (!r || !r.get('Activity T2 ID')) return null;
    var stage = (r.get('Current Stage') || "");
    var phase = (r.get('Phase') || "").toLowerCase();

    var theme = r.get('Activity T1 ID');
    var themeTitle = (themes && themes[theme] && themes[theme].title) || theme;
    var themeLocation = (themes && themes[theme] && themes[theme].location) || "Various";
    var themeId = (themes && themes[theme] && themes[theme].cardinality) || 30000;
    var formatted = {
            id: r.get('Activity T2 ID').slice(3),
            name: r.get('Activity Tier 2 Title'),
            description: r.get('Activity Tier 2 Description'),
            theme: themeTitle, 
            themeid: themeId,
            location: themeLocation,
            phase: phase,
            facing: r.get('Facing') === "Internal" ? 'internal' : 'user', 
            sro: r.get('SRO (T2)'),
            service_man: r.get('Programme Lead'),
            liveservice: r.get('Website'),
            priority: "High"
          };
    
    var stepsFormatted = [];
    for (var i in steps) {
      var name = steps[i].get('Activity Tier 3 Title');
      if (!name) continue;
      var s = [];
      if (steps[i].get('Activity Start Date')) s.push({label: "Start date", date: steps[i].get('Activity Start Date'), dateFormatted: new Date(steps[i].get('Activity Start Date')).toLocaleDateString()})
      if (steps[i].get('Target End Date')) s.push({label: "Target end date", date: steps[i].get('Target End Date'), dateFormatted: new Date(steps[i].get('Target End Date')).toLocaleDateString()})
      
      stepsFormatted.push({name: name, data: s})
    }

    // Heuristics to guess what sort of phase, if any, this step refers to
    //  (1) stage names containing phase words get associated with that phase
    //  (2) later stages are associated with the next phase UNLESS those later stages also include the phase word 
    var stepsFormatted = _.sortBy(stepsFormatted, function(x) {return x.data[0] && new Date(x.data[0].date)});
    var phaseSequence = ['backlog', 'discovery', 'alpha', 'beta', 'live'];
    var seqIdx = 0;
    for (var i in stepsFormatted) {
      var namehas = function(substr) {return stepsFormatted[i].name.toLowerCase().indexOf("pre-") === -1 && stepsFormatted[i].name.toLowerCase().match("(^|\\s)"+substr.toLowerCase()+"(\\s|$)")};
      stepsFormatted[i].phase = phaseSequence[seqIdx];
      if (seqIdx <= 2 && namehas("discovery")) stepsFormatted[i].phase = phaseSequence[(seqIdx = 2) - 1];
      if (seqIdx <= 3 && namehas("alpha")) stepsFormatted[i].phase = phaseSequence[(seqIdx = 3) - 1];
      if (seqIdx <= 4 && namehas("beta")) stepsFormatted[i].phase = phaseSequence[(seqIdx = 4) - 1];
      if (seqIdx <= 4 && namehas("live")) stepsFormatted[i].phase = phaseSequence[(seqIdx = 4)];
    }

    formatted.steps = stepsFormatted;

    // fall back to phase history if there are no steps
    if (!formatted.steps.length) {
      var phaseHistory = {};
      var startedLabel = !stage || stage.toLowerCase() === phase ? "Started" : stage;
      phaseHistory[phase] = [
        {label: startedLabel, date: r.get('Stage Start Date') || r.get('Start Date') || null }
      ];
      if (r.get('Stage End Date') || r.get('Target End Date')) phaseHistory[phase].push({label: "Predicted", date: r.get('Stage End Date') || r.get('Target End Date')});
      
      formatted["phase-history"] = phaseHistory;
    }
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

  var data = req.data || {};
  data.roots = {index: '', project: 'projects/', headertext: "DWP Digital by Default Services", pagetitle: "DWP Digital by Default Services"};
	res.render(path, data, function(err, html)
  {
		if (err) {
			res.render(path + "/index", data, function(err2, html)
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
