Package.describe({
    name: 'jandres:mutation-summary',
    summary: 'A JavaScript library that makes observing changes to the DOM easy.',
    version: '0.0.1',
    git: 'https://github.com/JoeyAndres/mutation-summary.git'
});

Package.onUse(function(api) {
    api.versionsFrom('METEOR@1.2');
    api.addFiles([
        'src/mutation-summary.js'
    ], 'client');
    api.export('MutationSummary', 'client');
});