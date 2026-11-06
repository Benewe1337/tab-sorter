// Ready-made rule sets offered on the empty state of the options page.
// They are only a starting point: users edit or delete them freely.

export const PRESETS = {
  starter: {
    labelKey: 'presetStarter',
    groups: [
      {
        title: 'Code',
        color: 'purple',
        patterns: [
          'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'developer.mozilla.org',
          'npmjs.com', 'pypi.org', 'vercel.app', 'localhost', '127.0.0.1',
        ],
      },
      {
        title: 'Docs',
        color: 'blue',
        patterns: ['docs.google.com', 'notion.so', 'atlassian.net/wiki', 'title:/Google (Docs|Sheets|Slides)/'],
      },
      {
        title: 'Mail',
        color: 'yellow',
        patterns: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.cloud.microsoft', 'mail.proton.me'],
      },
      {
        title: 'Video',
        color: 'red',
        patterns: ['youtube.com', 'twitch.tv', 'vimeo.com', 'netflix.com'],
      },
    ],
  },
  everyday: {
    labelKey: 'presetEveryday',
    groups: [
      {
        title: 'Shopping',
        color: 'orange',
        patterns: ['amazon.com', 'amazon.de', 'ebay.com', 'ebay.de', 'etsy.com', 'title:/warenkorb|shopping cart|checkout/'],
      },
      {
        title: 'Social',
        color: 'pink',
        patterns: ['reddit.com', 'x.com', 'bsky.app', 'mastodon.social', 'instagram.com', 'linkedin.com'],
      },
      {
        title: 'News',
        color: 'grey',
        patterns: ['news.ycombinator.com', 'theverge.com', 'bbc.com', 'tagesschau.de', 'heise.de'],
      },
      {
        title: 'Travel',
        color: 'cyan',
        patterns: ['maps.google.com', 'google.com/maps', 'booking.com', 'airbnb.com', 'bahn.de'],
      },
    ],
  },
};
