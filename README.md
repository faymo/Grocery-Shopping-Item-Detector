<div align="center">
<h3 align="center">Grocery Shopping Item Detector</h3>

  <p align="center">
    Detects grocery items using your phone's camera, aiding visually impaired shoppers.
    <br />
     <a href="https://shoppingitemdetector.vercel.app/">shoppingitemdetector.vercel.app</a>
  </p>
</div>

## About The Project

The Grocery Shopping Item Detector is a web application designed to assist visually impaired individuals in identifying grocery items. It leverages the device's camera and a TensorFlow.js object detection model (COCO-SSD) to identify items in real-time. The application provides voice feedback to announce detected items, and offers a high-contrast mode for improved visibility. This was built for the final project in the 1P13 Engineering Course at McMaster Engineering.

### Key Features

- **Real-time Object Detection:** Uses the device's camera to detect grocery items in real-time.
- **Voice Feedback:** Announces detected items using the Web Speech API.
- **High-Contrast Mode:** Provides a high-contrast black and white filter for improved visibility.
- **Mobile-Optimized:** Designed for optimal performance on mobile devices.
- **iOS Camera Support:** Implements iOS-friendly camera access and video playback.
- **Repeat Detection:** Allows users to repeat the latest detection announcement.
- **Toggleable Controls:** Ability to hide/show controls for a cleaner interface.

## Built With

- **Next.js:** A React framework for building web applications.
- **React:** A JavaScript library for building user interfaces.
- **TensorFlow.js:** A JavaScript library for training and deploying machine learning models in the browser.
- **COCO-SSD:** A pre-trained object detection model.
- **Tailwind CSS:** A utility-first CSS framework.

## Getting Started

To get a local copy up and running, follow these steps.

### Prerequisites

- Node.js and npm installed.

### Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/faymo/grocery-shopping-item-detector.git
   ```
2. Navigate to the project directory:
   ```sh
   cd faymo-grocery-shopping-item-detector/shopping-item-detector
   ```
3. Install the dependencies:
   ```sh
   npm install
   ```
4. Run the development server:
   ```sh
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Acknowledgments

- This README was created using [gitreadme.dev](https://gitreadme.dev) — an AI tool that looks at your entire codebase to instantly generate high-quality README files.
