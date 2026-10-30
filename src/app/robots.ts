import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', '/terms', '/privacy', '/ai-guide', '/delete-account'],
        disallow: ['/api/', '/home', '/library', '/notes', '/review', '/wrong', '/settings', '/admin', '/add', '/questions', '/plan', '/welcome'],
      },
    ],
  };
}
