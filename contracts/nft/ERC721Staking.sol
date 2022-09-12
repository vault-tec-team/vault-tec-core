// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IStakedERC721.sol";
import "./ERC721Saver.sol";

contract ERC721Staking is ReentrancyGuard, ERC721Saver {
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC721 public immutable nft;
    IStakedERC721 public immutable stakedNFT;

    uint256 public immutable maxLockDuration;
    uint256 public constant MIN_LOCK_DURATION = 10 minutes;

    // Constructor function to set the rewards token and the NFT collection addresses
    constructor(
        address _nft, 
        address _stakedNFT, 
        uint256 _maxLockDuration) {
        require(_nft != address(0), "ERC721Staking.constructor: nft cannot be zero address");
        require(_stakedNFT != address(0), "ERC721Staking.constructor: staked nft cannot be zero address");
        require(_maxLockDuration >= MIN_LOCK_DURATION, "ERC721Staking.constructor: max lock duration must be greater or equal to mininmum lock duration");

        nft = IERC721(_nft);
        stakedNFT = IStakedERC721(_stakedNFT);
        maxLockDuration = _maxLockDuration;
    }

    function stake(uint256 _tokenId, uint256 _duration) external nonReentrant {
        // Wallet must own the token they are trying to stake
        require(
            nft.ownerOf(_tokenId) == msg.sender,
            "ERC721Staking.stake: You don't own this token!"
        );

        // Don't allow locking > maxLockDuration
        uint256 duration = _duration.min(maxLockDuration);
        // Enforce min lockup duration to prevent flash loan or MEV transaction ordering
        duration = duration.max(MIN_LOCK_DURATION);

        // Transfer the token from the wallet to the Smart contract
        nft.transferFrom(msg.sender, address(this), _tokenId);

        stakedNFT.safeMint(
            msg.sender, 
            _tokenId,
            IStakedERC721.StakedInfo({
                start: uint64(block.timestamp),
                duration: duration,
                end: uint64(block.timestamp) + uint64(duration)
            })
        );
    }
    
    function unstake(uint256 _tokenId) external nonReentrant {
        require(
            stakedNFT.ownerOf(_tokenId) == msg.sender,
            "ERC721Staking.unstake: You don't own this token!"
        );
        nft.transferFrom(address(this), msg.sender, _tokenId);
        stakedNFT.burn(_tokenId);
    }
}