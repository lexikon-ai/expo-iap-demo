# Expo IAP (In-App Purchases) Demo for Google Play, Apple App Store (iOS), and Web

A reference implementation for in-app purchases using [`expo-iap`](https://github.com/hyochan/expo-iap).

## Features

- 🤓 Complete backend reference implementation
- 🔗 Webhook subscriptions to get notified about purchases and cancellations
- 🔄 Cross-platform support (iOS, Android, and Web via Stripe)
- 🤖 Designed for serverless environments like [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/) or [Cloudflare Workers](https://developers.cloudflare.com/workers/), but should work pretty much anywhere Node.js can run.
- 🛒 [Production implementation](https://lexikon.ai) has passed Google Play and Apple App Store certifications.

## Non-Features

- 🚫 Not designed as a reusable library. It is just a reference implementation - a starting off point so you don't have to start from scratch like we did. Feel free to copy and modify this codebase for your own needs, it is MIT licensed. Your implementation will depend on your auth layer, database, and what you are selling, as well as your hosting provider.
- 🚫 Focused around selling a single product (a subscription), but easily extendable to support other types of in-app purchases or multiple products.

## Usage

See [our corresponding blog post]() for more a more in-depth tutorial.

## Getting Started

This is a standard [expo default template](https://github.com/expo/expo/tree/main/templates/expo-template-default), feel free to follow the instructions there to get started.

## Credits

🤝 All credit really belongs to [Hyochan](https://github.com/hyochan) + the `expo-iap` [contributors](https://github.com/hyochan/expo-iap/graphs/contributors).
