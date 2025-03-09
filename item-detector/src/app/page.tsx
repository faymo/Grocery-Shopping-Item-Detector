"use client"

import { useState, useEffect, useRef } from "react";

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-converter';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

export default function Home() {
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [detections, setDetections] = useState<cocoSsd.DetectedObject[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [speakResults, setSpeakResults] = useState(true);
  const [lastSpokenItem, setLastSpokenItem] = useState("");
  const [processingInterval, setProcessingInterval] = useState<number>(2000); // ms between predictions
  const [error, setError] = useState<string | null>(null);
  
  // Tracking currently visible objects and which ones have been announced
  const currentlyVisibleObjectsRef = useRef<Set<string>>(new Set());
  const announcedObjectsRef = useRef<Set<string>>(new Set());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load the COCO-SSD model
  useEffect(() => {
    const loadModel = async () => {
      try {
        // Initialize TensorFlow.js before loading model
        await tf.ready();
        
        // Explicitly set backend to WebGL (important!)
        await tf.setBackend('webgl');
        console.log("Using TensorFlow backend:", tf.getBackend());
        
        // Create a dummy tensor to initialize the backend
        const dummyTensor = tf.zeros([1, 1, 1, 1]);
        dummyTensor.dispose();
        
        // Now load the COCO-SSD mode
        console.log("Loading COCO-SSD model...");
        const loadedModel = await cocoSsd.load({
          base: 'mobilenet_v2'
        });
        console.log("Model loaded successfully");
        
        setModel(loadedModel);
        setIsModelLoading(false);
      } catch (error) {
        console.error("Failed to load model:", error);
        setError(`Model loading error: ${error instanceof Error ? error.message : String(error)}`);
        setIsModelLoading(false);
      }
    };
    
    loadModel();
    
    // Cleanup function
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach(track => track.stop());
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);
  
  // Start/stop camera
  const toggleCamera = async () => {
    if (isCameraActive) {
      // Reset tracking when camera is turned off
      currentlyVisibleObjectsRef.current = new Set();
      announcedObjectsRef.current = new Set();

      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setIsCameraActive(false);
      setDetections([]);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      // Announce camera off
      speak("Camera turned off");
    } else {
      try {
        console.log("Requesting camera access...");
        const constraints = {
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Camera access granted");
        
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          
          setIsCameraActive(true);
          console.log("Camera active state set to TRUE");
          
          // Wait for video to be ready
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play().then(() => {
                console.log("Video playback started - camera is now active");
                speak("Camera started. Scanning for grocery items.");
                
                // Start detection after a short delay to ensure video is playing
                setTimeout(() => {
                  console.log("Starting detection interval, camera active:", isCameraActive);
                  startDetectionInterval();
                }, 500);
              }).catch(err => {
                console.error("Error starting video playback:", err);
                setError(`Video playback error: ${err instanceof Error ? err.message : String(err)}`);
                // Reset camera active state on error
                setIsCameraActive(false);
              });
            }
          };
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
        setError(`Camera access error: ${error instanceof Error ? error.message : String(error)}`);
        speak("Could not access camera. Please check permissions.");
        // Ensure camera state is false on error
        setIsCameraActive(false);
      }
    }
  };
  
  // Speak text using Web Speech API
  const speak = (text: string) => {
    if (!speakResults) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  };
  
  // Toggle speech feedback
  const toggleSpeech = () => {
    setSpeakResults(!speakResults);
    speak(speakResults ? "Voice feedback disabled" : "Voice feedback enabled");
  };
  
  // Start periodic detection
  const startDetectionInterval = () => {
    console.log("Starting detection interval - CURRENT camera state:", isCameraActive);
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Run detection immediately once
    detectObjects();
    
    // Then set up interval using a function that gets fresh state each time
    timerRef.current = setInterval(() => {
      // Check the current state directly from videoRef instead of relying on closed-over state
      const isVideoActive = videoRef.current && 
                          videoRef.current.srcObject && 
                          !videoRef.current.paused;
                          
      if (isVideoActive && !isCameraActive) {
        console.log("Video is active but state is false - fixing state");
        setIsCameraActive(true); // Update the state to match reality
      }
      
      detectObjects();
    }, processingInterval);
  };
  
  // Detect objects in video frame
  const detectObjects = async () => {
    // Check if video is actually playing
    const isVideoPlaying = videoRef.current && 
                          videoRef.current.srcObject && 
                          !videoRef.current.paused && 
                          videoRef.current.readyState >= 2;
    
    if (!model || !videoRef.current || !canvasRef.current || !isVideoPlaying) {
      console.log("Detection skipped - prerequisites not met");
      return;
    }
    
    try {
      // Detect objects
      const allPredictions = await model.detect(videoRef.current, undefined, 0.2);
      
      // Filter out person detections
      const predictions = allPredictions.filter(pred => pred.class !== "person");
      
      // Create a set of currently detected object classes
      const newVisibleObjects = new Set<string>();
      predictions.forEach(pred => {
        if (pred.score > 0.55) { // Only track high confidence detections
          newVisibleObjects.add(pred.class);
        }
      });
      
      // Find objects that disappeared since last detection
      const disappearedObjects: string[] = [];
      currentlyVisibleObjectsRef.current.forEach(obj => {
        if (!newVisibleObjects.has(obj)) {
          disappearedObjects.push(obj);
        }
      });
      
      // Remove disappeared objects from announcement tracking
      disappearedObjects.forEach(obj => {
        announcedObjectsRef.current.delete(obj);
        console.log(`Object disappeared and can be announced again: ${obj}`);
      });
      
      // Update currently visible objects
      currentlyVisibleObjectsRef.current = newVisibleObjects;
      
      // Update detections state for UI
      setDetections(predictions);
      
      // Draw the current frame and detection results
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        // Set canvas dimensions
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        
        // Draw video frame
        ctx.drawImage(videoRef.current, 0, 0);
        
        // Draw bounding boxes for each detected object
        predictions.forEach(prediction => {
          // Draw only if high enough confidence
          if (prediction.score > 0.55) {
            // Get coordinates and dimensions
            const [x, y, width, height] = prediction.bbox;
            
            // Draw bounding box
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, width, height);
            
            // Draw label background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            const padding = 4;
            const textWidth = ctx.measureText(prediction.class).width;
            ctx.fillRect(x, y - 30, textWidth + padding * 2, 30);
            
            // Draw label text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 16px Arial';
            ctx.fillText(prediction.class, x + padding, y - 10);
            
            // Mark if this object has been announced
            const isAnnounced = announcedObjectsRef.current.has(prediction.class);
            if (isAnnounced) {
              // Draw a small green dot to indicate this has been announced
              ctx.fillStyle = '#00FF00';
              ctx.beginPath();
              ctx.arc(x + width - 10, y - 20, 5, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });
        
        // Announce new high-confidence objects
        const highConfidencePredictions = predictions.filter(pred => 
          pred.score > 0.65 && !announcedObjectsRef.current.has(pred.class)
        );
        
        if (highConfidencePredictions.length > 0) {
          // Sort by confidence
          const topPrediction = highConfidencePredictions
            .sort((a, b) => b.score - a.score)[0];
          
          // Announce the top new object
          const className = topPrediction.class;
          console.log(`Announcing new object: ${className} (${topPrediction.score.toFixed(2)})`);
          speak(className);
          
          // Mark as announced
          announcedObjectsRef.current.add(className);
          setLastSpokenItem(className);
        }
      }
    } catch (error) {
      console.error("Error during detection:", error);
    }
  };
  
  // Function to repeat the latest detection announcement
  const repeatLatestDetection = () => {
    // Find the top detection from current detections
    if (detections.length > 0) {
      // Sort by confidence and get the top one
      const topDetection = [...detections]
        .filter(det => det.class !== "person")
        .sort((a, b) => b.score - a.score)[0];
      
      if (topDetection) {
        console.log(`Repeating detection: ${topDetection.class}`);
        speak(`${topDetection.class}`);
      } else {
        speak("No objects currently detected");
      }
    } else {
      speak("No objects currently detected");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4" role="application" aria-label="Grocery Assistant">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-6" tabIndex={0}>Grocery Assistant</h1>
        
        {/* Model loading state */}
        {isModelLoading && (
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="w-16 h-16 border-8 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-xl" tabIndex={0}>Loading grocery recognition model...</p>
          </div>
        )}
        
        {/* Error message */}
        {error && (
          <div className="bg-red-800 p-4 rounded-lg mb-6">
            <p className="font-bold">Error occurred:</p>
            <p>{error}</p>
            <button 
              onClick={() => setError(null)}
              className="mt-2 bg-red-600 px-4 py-2 rounded"
            >
              Dismiss
            </button>
          </div>
        )}
        
        {/* Camera container */}
        <div className="relative w-full max-w-2xl mx-auto aspect-video bg-black rounded-lg overflow-hidden border-4 border-gray-700">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
            aria-hidden="true"
          ></video>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover"
            aria-hidden="true"
          ></canvas>
          
          {!isCameraActive && !isModelLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80">
              <p className="text-2xl" tabIndex={0}>Camera is off</p>
            </div>
          )}
        </div>
        
        {/* Controls */}
        <div className="flex flex-col sm:flex-row justify-center gap-4 mt-8 flex-wrap">
          <button
            onClick={toggleCamera}
            disabled={isModelLoading}
            className={`px-8 py-5 rounded-xl text-xl font-bold transition-colors ${
              isCameraActive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-green-600 hover:bg-green-700"
            } ${isModelLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            aria-label={isCameraActive ? "Stop Camera" : "Start Camera"}
          >
            {isCameraActive ? "STOP CAMERA" : "START CAMERA"}
          </button>
          
          <button
            onClick={toggleSpeech}
            className={`px-8 py-5 rounded-xl text-xl font-bold transition-colors ${
              speakResults ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-600 hover:bg-gray-700"
            }`}
            aria-label={speakResults ? "Turn off voice feedback" : "Turn on voice feedback"}
          >
            {speakResults ? "VOICE ON" : "VOICE OFF"}
          </button>
          
          {/* Add repeat detection button */}
          <button
            onClick={repeatLatestDetection}
            disabled={!isCameraActive || detections.length === 0}
            className="px-8 py-5 rounded-xl text-xl font-bold transition-colors bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50"
            aria-label="Repeat latest detection"
          >
            REPEAT DETECTION
          </button>
        </div>
        {/* Add detection indicator */}
        {isCameraActive && !isModelLoading && (
          <div className="absolute top-2 right-2 bg-black bg-opacity-70 px-3 py-1 rounded-lg text-sm">
            {detections.length > 0 ? `Detected: ${detections.length} items` : "Scanning..."}
          </div>
        )}
        {/* Detections list */}
        <div className="mt-8" aria-live="polite">
          <h2 className="text-2xl font-bold mb-4" tabIndex={0}>Detected Items</h2>
          {detections.length > 0 ? (
            <ul className="bg-gray-900 rounded-xl p-6 border-2 border-gray-700" role="list">
              {detections.map((detection, index) => (
                <li key={index} className="flex justify-between items-center py-3 border-b border-gray-700 last:border-none" tabIndex={0}>
                  <span className="font-bold text-xl capitalize">{detection.class}</span>
                  <span className="bg-blue-600 px-4 py-2 rounded-xl text-lg">
                    {(detection.score * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-xl" tabIndex={0}>
              {isCameraActive ? "Scanning for grocery items..." : "Start the camera to detect items"}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}