var express = require('express'),
    router  = express.Router(),
    _       = require('underscore');

/*
  A way to force the ordering of the themes.
*/
var theme_order = [
      // 'Universal Credit',
      'Health & Disability',
      'Working Age',
      'Retirement Provision',
      'Fraud & Debt',
      'Platforms'
    ];

var priority_order = [
      'Top',
      'High',
      'Medium',
      'Low'
    ];

var priority_descriptions = {
      "Top":"Helping people return to work through Universal Credit and solving urgent problems that affect the whole department.",
      "High":"Helping people prepare for retirement and manage their debt.",
      "Medium":"Helping people apply for and get existing products across the department.",
      "Low":"Non-urgent services and those that have short-term benefit."
    };

/*
  A way to force the ordering of the phases.
*/
var phase_order = ['backlog','discovery','alpha','beta','live'];

var roots = {index: '', project: 'projects', headertext: "DWP Digital by Default Services"};
var bisRoots = {index: 'bis', project: 'bis/projects', headertext: "(the department formerly known as)BIS Portfolio"};

/*
  A function to gather the data by
  'phase' and then 'facing' so the
  index.html can spit them out.
*/
function indexify(data)
{
  var new_data = {};
  _.each(data, function(value, key, list)
  {
    var item = _.groupBy(value,'phase');
    new_data[key] = {};
    _.each(item, function(v,k,l)
    {
      var piece = _.groupBy(v,'facing');
      new_data[key][k] = piece;
    });
  });
  return new_data;
}


/*
  - - - - - - - - - - BIS INDEX PAGE - - - - - - - - - -
*/

router.get('/bis', function(req, res) {
  getAllBisProjects(req, res, 'theme', 'themeid');
});


router.get('/bis/priority', function(req,res) {
  getAllBisProjects(req, res, 'priority');
});

router.get('/bis/location', function(req, res) {
  getAllBisProjects(req, res, 'location');
});


function getAllBisProjects(req, res, groupField, groupSortField) {
  groupSortField = groupSortField || groupField; 
  req.app.locals.bisdata.getAll(function (err, allprojects) {
    var dat = {
      data: indexify(_.groupBy(allprojects, groupField)),
      counts: _.countBy(allprojects, 'phase'),
      view: groupField,
      theme_order: _.uniq(_.map(_.sortBy(allprojects, groupSortField), function(x){return x[groupField]})),//theme_order,
      phase_order: phase_order, 
      roots: bisRoots
    };
    console.log(dat);
    res.render('index', dat);
  });
}
/*
  - - - - - - - - - -  INDEX PAGE - - - - - - - - - -
*/
router.get('/', function (req, res)
{
  var data = _.groupBy(req.app.locals.data, 'theme');
  var new_data = indexify(data);
  var phases = _.countBy(req.app.locals.data, 'phase');
  res.render('index', {
    "data":new_data,
    "counts":phases,
    "view":"theme",
    "theme_order":theme_order,
    "phase_order":phase_order,
    "roots": roots
    }
  );
});

/*
  - - - - - - - - - -  LOCATION INDEX PAGE - - - - - - - - - -
*/
router.get('/location/', function (req, res)
{
  var data = _.groupBy(req.app.locals.data, 'location');
  var new_data = indexify(data);

  var loc_order = [];
  _.each(data, function(value, key, list)
  {
    loc_order.push(key);
  });
  loc_order.sort();

  var phases = _.countBy(req.app.locals.data, 'phase');
  res.render('index', {
    "data":new_data,
    "counts":phases,
    "view":"location",
    "theme_order":loc_order,
    "phase_order":phase_order,
    "roots": roots
  });
});

/*
  - - - - - - - - - -  INDEX PAGE - - - - - - - - - -
*/
router.get('/priority/', function (req, res)
{
  var data = _.groupBy(req.app.locals.data, 'priority');
  var new_data = indexify(data);

  var phases = _.countBy(req.app.locals.data, 'phase');

  res.render('index', {
    "data":new_data,
    "counts":phases,
    "view":"priority",
    "theme_order":priority_order,
    "phase_order":phase_order,
    "priority_descriptions":priority_descriptions,
    "roots": roots
    }
  );
});
/*
  - - - - - - - - - -  BIS PROJECT PAGE - - - - - - - - - -
*/

router.get('/bis/projects/:id/:slug?', function (req, res) {
  req.app.locals.bisdata.getProject(req.params.id, function (err, record)  {   
    if (err) {
      res.status(404).send(err);
    } else {
      res.render('project', {data:record, phase_order:phase_order, roots: bisRoots});
    };
  });
});

/*
  - - - - - - - - - -  PROJECT PAGE - - - - - - - - - -
*/
router.get('/projects/:id/:slug', function (req, res)
{
  var data = _.findWhere(req.app.locals.data, {id:parseInt(req.params.id)});
  res.render('project', {
    "data":data,
    "phase_order":phase_order,
    "roots":roots
  });
});

/*
  - - - - - - - - - -  PROTOTYPE REDRIECT - - - - - - - - - -
*/
router.get('/projects/:id/:slug/prototype', function (req, res)
{
  var id = req.params.id;
  var data = _.findWhere(req.app.locals.data, {id:parseInt(id)});
  if (typeof data.prototype == 'undefined')
  {
    res.render('no-prototype',{
      "data":data,
    });
  } else {
    res.redirect(data.prototype);
  }
});

/*
  - - - - - - - - - -  ALL THE DATA AS JSON - - - - - - - - - -
*/

router.get('/api', function (req, res) {
  console.log(req.app.locals.data);
  res.json(req.app.locals.data);
});

router.get('/api/:id', function (req, res) {
  var data = _.findWhere(req.app.locals.data, {id: (parseInt(req.params.id))});
  if (data) {
    res.json(data);
  } else {
    res.json({error: 'ID not found'});
  }
});

module.exports = router;
